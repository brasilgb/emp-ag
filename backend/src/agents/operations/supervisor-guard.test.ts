import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isOperationalSupervisionRunning, runGuardedOperationalSupervision, SupervisionAlreadyRunningError } from './supervisor-guard.js';
import type { OperationalSupervisionReport } from './health-types.js';

function fakeReport(overrides: Partial<OperationalSupervisionReport> = {}): OperationalSupervisionReport {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun: false,
    signalsDetected: 0,
    incidentsDetected: 0,
    observed: 0,
    recovered: 0,
    autonomyRestricted: 0,
    escalated: 0,
    failed: 0,
    results: [],
    ...overrides,
  };
}

function delayedRunner(delayMs: number, report: OperationalSupervisionReport) {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return report;
  };
}

function throwingRunner(message: string) {
  return async (): Promise<OperationalSupervisionReport> => {
    throw new Error(message);
  };
}

/*
 * Agentes v2.5.1 (correio.md seção 33, "concorrência") — o guard central
 * único (supervisor-guard.ts), testado isoladamente com um `runner`
 * injetado (nunca precisa forçar falha real de banco/rede para provar
 * liberação em erro).
 */
describe('Agentes v2.5.1 - supervisor-guard (guard central)', () => {
  test('6/13: guard fica livre novamente após execução bem-sucedida', async () => {
    assert.equal(isOperationalSupervisionRunning(), false);
    await runGuardedOperationalSupervision({ actorUserId: null }, async () => fakeReport());
    assert.equal(isOperationalSupervisionRunning(), false);
  });

  test('7/14: guard fica livre novamente mesmo quando a supervisão lança exceção', async () => {
    assert.equal(isOperationalSupervisionRunning(), false);
    await assert.rejects(() => runGuardedOperationalSupervision({ actorUserId: null }, throwingRunner('falha simulada')), /falha simulada/);
    assert.equal(isOperationalSupervisionRunning(), false);
  });

  test('9: uma chamada normal após uma falha anterior funciona normalmente (guard não fica preso)', async () => {
    await assert.rejects(() => runGuardedOperationalSupervision({ actorUserId: null }, throwingRunner('falha 1')));
    const report = await runGuardedOperationalSupervision({ actorUserId: null }, async () => fakeReport({ incidentsDetected: 5 }));
    assert.equal(report.incidentsDetected, 5);
  });

  test('5/11/12: duas chamadas concorrentes → só a primeira executa de verdade, a segunda recebe SupervisionAlreadyRunningError', async () => {
    const first = runGuardedOperationalSupervision({ actorUserId: null }, delayedRunner(150, fakeReport({ incidentsDetected: 1 })));

    // Pequeno atraso para garantir que `first` já adquiriu o guard antes
    // de `second` tentar (sem `await` entre check-and-set no guard —
    // não há corrida real, mas isto ordena os disparos no teste).
    await new Promise((resolve) => setTimeout(resolve, 10));

    await assert.rejects(
      () => runGuardedOperationalSupervision({ actorUserId: null }, delayedRunner(50, fakeReport({ incidentsDetected: 2 }))),
      (error: unknown) => error instanceof SupervisionAlreadyRunningError,
    );

    const firstResult = await first;
    assert.equal(firstResult.incidentsDetected, 1, 'só a primeira chamada deveria ter executado de verdade');
    assert.equal(isOperationalSupervisionRunning(), false, 'guard deveria estar livre após a primeira terminar');
  });

  test('running reflete o estado real durante a execução', async () => {
    const promise = runGuardedOperationalSupervision({ actorUserId: null }, delayedRunner(80, fakeReport()));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(isOperationalSupervisionRunning(), true);
    await promise;
    assert.equal(isOperationalSupervisionRunning(), false);
  });
});
