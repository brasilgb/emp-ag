import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeInitiativeProgress, deriveInitiativeExecutionState } from './initiatives-progress.js';

function items(...statuses: string[]) {
  return statuses.map((executionStatus) => ({ executionStatus }));
}

/*
 * Agentes v2.1 (correio.md seção 6/7/19; saneamento seção 3) — cálculo
 * de progresso: função pura, sem banco. Cobertura obrigatória: 0 items,
 * parcial, 100%, approval pendente, blocked, failed — mais a
 * reclassificação de `skipped` (shadow) para fora de `blockedItems`.
 */
describe('computeInitiativeProgress', () => {
  test('0 items → 0%, todos os baldes zerados', () => {
    const progress = computeInitiativeProgress([]);
    assert.deepEqual(progress, {
      totalItems: 0,
      completedItems: 0,
      failedItems: 0,
      blockedItems: 0,
      pendingApprovalItems: 0,
      runningItems: 0,
      shadowedItems: 0,
      progressPercent: 0,
    });
  });

  test('parcial: alguns concluídos, alguns ainda em voo', () => {
    const progress = computeInitiativeProgress(items('completed', 'completed', 'pending', 'executing'));
    assert.equal(progress.totalItems, 4);
    assert.equal(progress.completedItems, 2);
    assert.equal(progress.runningItems, 2);
    assert.equal(progress.progressPercent, 50);
  });

  test('100%: todos completed', () => {
    const progress = computeInitiativeProgress(items('completed', 'completed', 'completed'));
    assert.equal(progress.progressPercent, 100);
    assert.equal(progress.completedItems, 3);
  });

  test('approval pendente: waiting_approval não conta como concluído (seção 6)', () => {
    const progress = computeInitiativeProgress(items('completed', 'waiting_approval'));
    assert.equal(progress.pendingApprovalItems, 1);
    assert.equal(progress.progressPercent, 50);
  });

  test('blocked: só execution_status="blocked" conta — "skipped" NUNCA (saneamento seção 3)', () => {
    const progress = computeInitiativeProgress(items('completed', 'blocked', 'skipped'));
    assert.equal(progress.blockedItems, 1, 'skipped não é blocked');
    assert.equal(progress.shadowedItems, 1, 'skipped vai para o balde shadowedItems');
    assert.equal(progress.progressPercent, Math.round((1 / 3) * 100));
  });

  test('shadowed: skipped nunca conta como concluído (progressPercent nunca inflado)', () => {
    const progress = computeInitiativeProgress(items('completed', 'skipped', 'skipped'));
    assert.equal(progress.shadowedItems, 2);
    assert.equal(progress.blockedItems, 0);
    assert.equal(progress.progressPercent, Math.round((1 / 3) * 100));
  });

  test('failed: failed e rejected não contam como concluído', () => {
    const progress = computeInitiativeProgress(items('completed', 'failed', 'rejected'));
    assert.equal(progress.failedItems, 2);
    assert.equal(progress.progressPercent, Math.round((1 / 3) * 100));
  });

  test('running: pending/approved/executing são a mesma categoria "em voo"', () => {
    const progress = computeInitiativeProgress(items('pending', 'approved', 'executing'));
    assert.equal(progress.runningItems, 3);
    assert.equal(progress.progressPercent, 0);
  });

  test('cada balde é exaustivo — a soma de todos os 6 baldes é sempre igual a totalItems', () => {
    const progress = computeInitiativeProgress(
      items('completed', 'failed', 'rejected', 'blocked', 'skipped', 'waiting_approval', 'pending', 'approved', 'executing'),
    );
    const sum =
      progress.completedItems +
      progress.failedItems +
      progress.blockedItems +
      progress.pendingApprovalItems +
      progress.runningItems +
      progress.shadowedItems;
    assert.equal(sum, progress.totalItems);
  });
});

describe('deriveInitiativeExecutionState', () => {
  test('sem Action Plan → not_started', () => {
    assert.equal(deriveInitiativeExecutionState(false, computeInitiativeProgress([])), 'not_started');
  });

  test('Action Plan sem nenhum item → not_started', () => {
    assert.equal(deriveInitiativeExecutionState(true, computeInitiativeProgress([])), 'not_started');
  });

  test('algo em voo sempre vence, mesmo com itens bloqueados/pendentes de approval também presentes', () => {
    const progress = computeInitiativeProgress(items('executing', 'blocked', 'waiting_approval'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'running');
  });

  test('sem nada em voo, mas com approval pendente → waiting_approval (mesmo com item bloqueado presente)', () => {
    const progress = computeInitiativeProgress(items('waiting_approval', 'blocked'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'waiting_approval');
  });

  test('sem voo/pendência, com bloqueio REAL (execution_status="blocked") → blocked (mesmo com item falho presente)', () => {
    const progress = computeInitiativeProgress(items('blocked', 'failed'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'blocked');
  });

  test('sem voo/pendência/bloqueio, com falha → failed', () => {
    const progress = computeInitiativeProgress(items('completed', 'failed'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'failed');
  });

  test('tudo completed → completed', () => {
    const progress = computeInitiativeProgress(items('completed', 'completed'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'completed');
  });

  test('saneamento seção 3: item "skipped" (shadow) NUNCA vira blocked — completed+skipped, nada mais pendente → completed', () => {
    const progress = computeInitiativeProgress(items('completed', 'completed', 'skipped'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'completed');
  });

  test('saneamento seção 3: plano 100% shadow (Shadow Mode cobriu tudo) → completed, nunca blocked', () => {
    const progress = computeInitiativeProgress(items('skipped', 'skipped'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'completed');
  });

  test('bloqueio real (blocked de verdade) continua vencendo mesmo com itens shadowed presentes', () => {
    const progress = computeInitiativeProgress(items('completed', 'skipped', 'blocked'));
    assert.equal(deriveInitiativeExecutionState(true, progress), 'blocked');
  });
});
