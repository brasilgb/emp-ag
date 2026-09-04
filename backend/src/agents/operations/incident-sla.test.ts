import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeIncidentSla } from './supervision-insights-service.js';

const SLA_MINUTES = { info: 1440, warning: 240, critical: 60 };

/**
 * Agentes v4.1 (correio.md "Operational Incident Aging & SLA
 * Visibility", "16. Testes obrigatórios") — `computeIncidentSla` é PURA
 * (nenhum I/O), então a maior parte dos itens obrigatórios (1-5, 11, 12,
 * 19) é testável diretamente aqui, sem Postgres — mesma técnica já usada
 * por `sortOperationalIncidentTimelineEvents` (v4.0).
 */
describe('Agentes v4.1 - computeIncidentSla (função pura)', () => {
  const detectedAt = new Date('2026-01-01T00:00:00.000Z');

  test('1: incidente recém-detectado dentro do SLA → within_sla', () => {
    const sla = computeIncidentSla({
      severity: 'critical',
      detectedAt,
      reviewStatus: 'unreviewed',
      closedAt: null,
      assignedAt: null,
      lastActivityAt: detectedAt,
      now: new Date(detectedAt.getTime() + 5 * 60 * 1000), // 5min depois, SLA critical = 60min
      slaMinutesBySeverity: SLA_MINUTES,
    });
    assert.equal(sla.status, 'within_sla');
    assert.equal(sla.ageSeconds, 5 * 60);
    assert.equal(sla.deadlineAt, new Date(detectedAt.getTime() + 60 * 60 * 1000).toISOString());
    assert.equal(sla.remainingSeconds, 55 * 60);
    assert.equal(sla.breachedAt, null);
  });

  test('2: incidente próximo do prazo → warning (últimos 20% do SLA)', () => {
    // SLA critical = 60min → warning começa a 12min do fim (20% de 60min).
    const now = new Date(detectedAt.getTime() + 49 * 60 * 1000); // restam 11min < 12min
    const sla = computeIncidentSla({ severity: 'critical', detectedAt, reviewStatus: 'unreviewed', closedAt: null, assignedAt: null, lastActivityAt: detectedAt, now, slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.status, 'warning');
    assert.equal(sla.remainingSeconds, 11 * 60);

    // Um minuto antes ainda deveria estar within_sla (13min restantes > 12min).
    const stillOnTrack = computeIncidentSla({ severity: 'critical', detectedAt, reviewStatus: 'unreviewed', closedAt: null, assignedAt: null, lastActivityAt: detectedAt, now: new Date(detectedAt.getTime() + 47 * 60 * 1000), slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(stillOnTrack.status, 'within_sla');
  });

  test('3/4/5: incidente vencido → breached; deadlineAt e tempo restante (negativo) corretos', () => {
    const now = new Date(detectedAt.getTime() + 90 * 60 * 1000); // 30min depois do deadline de 60min
    const sla = computeIncidentSla({ severity: 'critical', detectedAt, reviewStatus: 'unreviewed', closedAt: null, assignedAt: null, lastActivityAt: detectedAt, now, slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.status, 'breached');
    assert.equal(sla.deadlineAt, new Date(detectedAt.getTime() + 60 * 60 * 1000).toISOString());
    assert.equal(sla.remainingSeconds, -30 * 60);
    assert.equal(sla.breachedAt, sla.deadlineAt);
  });

  test('7: incidente atribuído — assignmentAgeSeconds calculado a partir de assignedAt', () => {
    const assignedAt = new Date(detectedAt.getTime() + 10 * 60 * 1000);
    const now = new Date(detectedAt.getTime() + 40 * 60 * 1000);
    const sla = computeIncidentSla({ severity: 'warning', detectedAt, reviewStatus: 'acknowledged', closedAt: null, assignedAt, lastActivityAt: assignedAt, now, slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.assignedAt, assignedAt.toISOString());
    assert.equal(sla.assignmentAgeSeconds, 30 * 60);
  });

  test('9: unassignment remove contexto de assignment corrente (assignedAt/assignmentAgeSeconds nulos)', () => {
    const now = new Date(detectedAt.getTime() + 40 * 60 * 1000);
    const sla = computeIncidentSla({ severity: 'warning', detectedAt, reviewStatus: 'acknowledged', closedAt: null, assignedAt: null, lastActivityAt: detectedAt, now, slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.assignedAt, null);
    assert.equal(sla.assignmentAgeSeconds, null);
  });

  test('11: incidente resolved deixa de acumular aging operacional (completed, congelado no fechamento)', () => {
    // Fechado em t+30min (dentro do SLA de 60min), mas lido bem depois (t+500min) — status nunca deveria virar "breached".
    const closedAt = new Date(detectedAt.getTime() + 30 * 60 * 1000);
    const now = new Date(detectedAt.getTime() + 500 * 60 * 1000);
    const sla = computeIncidentSla({ severity: 'critical', detectedAt, reviewStatus: 'resolved', closedAt, assignedAt: null, lastActivityAt: closedAt, now, slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.status, 'completed');
    assert.equal(sla.remainingSeconds, 30 * 60, 'remainingSeconds deveria refletir o momento do fechamento, não "agora"');
    assert.equal(sla.breachedAt, null, 'fechado dentro do prazo — nunca breach');
  });

  test('11 (variante): incidente resolved DEPOIS do prazo continua completed, mas breachedAt preserva o fato histórico', () => {
    const closedAt = new Date(detectedAt.getTime() + 90 * 60 * 1000); // 30min após o deadline de 60min
    const now = new Date(detectedAt.getTime() + 500 * 60 * 1000);
    const sla = computeIncidentSla({ severity: 'critical', detectedAt, reviewStatus: 'resolved', closedAt, assignedAt: null, lastActivityAt: closedAt, now, slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.status, 'completed', 'nunca "breached" depois de encerrado — completed sempre tem precedência (correio.md seção 7)');
    assert.equal(sla.remainingSeconds, -30 * 60);
    assert.equal(sla.breachedAt, sla.deadlineAt, 'o fato de ter violado o SLA antes de fechar continua visível');
  });

  test('12: incidente dismissed também é completed (mesma semântica de resolved)', () => {
    const closedAt = new Date(detectedAt.getTime() + 10 * 60 * 1000);
    const sla = computeIncidentSla({ severity: 'critical', detectedAt, reviewStatus: 'dismissed', closedAt, assignedAt: null, lastActivityAt: closedAt, now: new Date(detectedAt.getTime() + 999 * 60 * 1000), slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.status, 'completed');
  });

  test('19: timestamps empatados continuam determinísticos — mesma entrada produz sempre a mesma saída', () => {
    const now = new Date(detectedAt.getTime() + 45 * 60 * 1000);
    const input = { severity: 'warning' as const, detectedAt, reviewStatus: 'unreviewed' as const, closedAt: null, assignedAt: null, lastActivityAt: detectedAt, now, slaMinutesBySeverity: SLA_MINUTES };
    const a = computeIncidentSla(input);
    const b = computeIncidentSla(input);
    assert.deepEqual(a, b);
  });

  test('campos não aplicáveis são null, nunca 0 ou inventados (correio.md seção 5)', () => {
    const sla = computeIncidentSla({ severity: 'info', detectedAt, reviewStatus: 'unreviewed', closedAt: null, assignedAt: null, lastActivityAt: detectedAt, now: detectedAt, slaMinutesBySeverity: SLA_MINUTES });
    assert.equal(sla.assignedAt, null);
    assert.equal(sla.assignmentAgeSeconds, null);
    assert.equal(sla.breachedAt, null);
  });
});
