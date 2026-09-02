import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computePriority, daysBetween } from './priority.js';
import { buildDeduplicationKey } from './dedup.js';
import { resolveImpact } from './impact.js';
import { resolveUrgency } from './urgency.js';

/*
 * Agentes v1.9 (correio.md secao 32 "Priority") - determinismo puro,
 * sem banco.
 */
describe('computePriority', () => {
  test('critical supera attention em condições equivalentes', () => {
    const critical = computePriority({ severity: 'critical', impact: 'medium', urgency: 'normal', agingDays: 0, occurrenceCount: 1 });
    const attention = computePriority({ severity: 'attention', impact: 'medium', urgency: 'normal', agingDays: 0, occurrenceCount: 1 });
    assert.ok(critical.total > attention.total);
  });

  test('aging aumenta prioridade conforme regra (2 pontos/dia, capado em 40)', () => {
    const fresh = computePriority({ severity: 'warning', impact: 'medium', urgency: 'normal', agingDays: 0, occurrenceCount: 1 });
    const aged5 = computePriority({ severity: 'warning', impact: 'medium', urgency: 'normal', agingDays: 5, occurrenceCount: 1 });
    const agedHuge = computePriority({ severity: 'warning', impact: 'medium', urgency: 'normal', agingDays: 1000, occurrenceCount: 1 });

    assert.equal(aged5.total - fresh.total, 10);
    assert.equal(agedHuge.aging.weight, 40, 'aging deve ser capado em 40 pontos.');
  });

  test('recurrence aumenta prioridade conforme regra (5 pontos/ocorrência extra, capado em 30)', () => {
    const first = computePriority({ severity: 'warning', impact: 'medium', urgency: 'normal', agingDays: 0, occurrenceCount: 1 });
    const third = computePriority({ severity: 'warning', impact: 'medium', urgency: 'normal', agingDays: 0, occurrenceCount: 3 });
    const huge = computePriority({ severity: 'warning', impact: 'medium', urgency: 'normal', agingDays: 0, occurrenceCount: 1000 });

    assert.equal(third.total - first.total, 10);
    assert.equal(huge.recurrence.weight, 30, 'recurrence deve ser capada em 30 pontos.');
  });

  test('score é explicável: total é sempre a soma exata dos fatores', () => {
    const factors = computePriority({ severity: 'critical', impact: 'high', urgency: 'immediate', agingDays: 3, occurrenceCount: 4 });
    const sum = factors.severity.weight + factors.impact.weight + factors.urgency.weight + factors.aging.weight + factors.recurrence.weight;
    assert.equal(factors.total, sum);
  });

  test('desempate determinístico: severidade+impacto+urgência iguais e mesmo aging/recurrence produzem o mesmo score', () => {
    const a = computePriority({ severity: 'warning', impact: 'medium', urgency: 'soon', agingDays: 2, occurrenceCount: 2 });
    const b = computePriority({ severity: 'warning', impact: 'medium', urgency: 'soon', agingDays: 2, occurrenceCount: 2 });
    assert.equal(a.total, b.total);
  });
});

describe('daysBetween', () => {
  test('now controlado, nunca Date.now() implícito', () => {
    const from = new Date('2026-06-01T00:00:00.000Z');
    const to = new Date('2026-06-05T00:00:00.000Z');
    assert.equal(daysBetween(from, to), 4);
  });
});

describe('resolveImpact', () => {
  test('support.ticket_critical → high (regra fixa por signalType)', () => {
    assert.equal(resolveImpact({ type: 'support.ticket_critical', metadata: {} }), 'high');
  });

  test('projects.task_unassigned → low (menor que projeto inteiro vencido)', () => {
    assert.equal(resolveImpact({ type: 'projects.task_unassigned', metadata: {} }), 'low');
    assert.equal(resolveImpact({ type: 'projects.project_overdue', metadata: {} }), 'high');
  });

  test('finance.receivable_overdue usa o valor real do sinal quando disponível', () => {
    assert.equal(resolveImpact({ type: 'finance.receivable_overdue', metadata: { amount: '6000' } }), 'high');
    assert.equal(resolveImpact({ type: 'finance.receivable_overdue', metadata: { amount: '2000' } }), 'medium');
    assert.equal(resolveImpact({ type: 'finance.receivable_overdue', metadata: { amount: '100' } }), 'low');
  });

  test('finance sem valor disponível cai no default do tipo (medium)', () => {
    assert.equal(resolveImpact({ type: 'finance.receivable_overdue', metadata: {} }), 'medium');
  });

  test('agents.job_circuit_open → high (impacto elevado para operação automatizada)', () => {
    assert.equal(resolveImpact({ type: 'agents.job_circuit_open', metadata: {} }), 'high');
  });
});

describe('resolveUrgency', () => {
  test('SLA já vencido/circuit breaker aberto → immediate', () => {
    assert.equal(resolveUrgency({ type: 'support.ticket_critical' }), 'immediate');
    assert.equal(resolveUrgency({ type: 'agents.job_circuit_open' }), 'immediate');
    assert.equal(resolveUrgency({ type: 'finance.receivable_overdue' }), 'immediate');
  });

  test('due-soon/pendências leves → soon; hygiene → normal', () => {
    assert.equal(resolveUrgency({ type: 'projects.task_due_soon' }), 'soon');
    assert.equal(resolveUrgency({ type: 'projects.task_unassigned' }), 'normal');
  });
});

describe('buildDeduplicationKey', () => {
  test('mesma chave para o mesmo signalType+entityType+entityId', () => {
    const key1 = buildDeduplicationKey({ type: 'projects.task_overdue', entityType: 'task', entityId: 42, id: 'x' });
    const key2 = buildDeduplicationKey({ type: 'projects.task_overdue', entityType: 'task', entityId: 42, id: 'y' });
    assert.equal(key1, key2, 'a chave não deve depender do id efêmero do signal, só de type+entityType+entityId.');
  });

  test('entidades diferentes geram chaves diferentes', () => {
    const key1 = buildDeduplicationKey({ type: 'projects.task_overdue', entityType: 'task', entityId: 42, id: 'x' });
    const key2 = buildDeduplicationKey({ type: 'projects.task_overdue', entityType: 'task', entityId: 43, id: 'x' });
    assert.notEqual(key1, key2);
  });

  test('sinal sem entityId cai no fallback estável do próprio signal.id (nunca texto de LLM)', () => {
    const key = buildDeduplicationKey({ type: 'agents.incident.foo', entityType: undefined, entityId: undefined, id: 'agents.incident:event_delivery:99' });
    assert.equal(key, 'agents.incident.foo::none::agents.incident:event_delivery:99');
  });
});
