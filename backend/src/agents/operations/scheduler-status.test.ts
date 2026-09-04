import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { settings } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { getOperationalSupervisionSchedulerStatus } from './scheduler-status.js';
import { runScheduledOperationalSupervision, startOperationalSupervisionScheduler, stopOperationalSupervisionScheduler } from './scheduler.js';
import { OPERATIONAL_SUPERVISION_SETTING_KEY, setOperationalSupervisionEnabled } from './scheduler-settings.js';
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
    escalationsAttempted: 0,
    escalationsSucceeded: 0,
    escalationsFailed: 0,
    results: [],
    ...overrides,
  };
}

/*
 * Agentes v2.5.1 (correio.md seção 35, "observabilidade") — itens
 * 24-30.
 */
describe('Agentes v2.5.1 - getOperationalSupervisionSchedulerStatus', () => {
  after(async () => {
    stopOperationalSupervisionScheduler();
    await db.delete(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY));
    await database.end();
    redis.disconnect();
  });

  test('24: status mostra enabled corretamente (reflete o setting persistido)', async () => {
    await setOperationalSupervisionEnabled(false);
    assert.equal((await getOperationalSupervisionSchedulerStatus()).enabled, false);

    await setOperationalSupervisionEnabled(true);
    assert.equal((await getOperationalSupervisionSchedulerStatus()).enabled, true);
  });

  test('26/27/29: lastStartedAt/lastCompletedAt são atualizados após um tick bem-sucedido, duração calculada corretamente', async () => {
    await setOperationalSupervisionEnabled(true);

    // Sem runner injetado — usa a `runOperationalSupervision` REAL, cujo
    // próprio `audit()` interno (scan.started/scan.completed) é o que
    // este teste precisa observar (um runner fake substituiria essa
    // chamada inteira, nunca emitindo esses eventos).
    const before = new Date();
    await runScheduledOperationalSupervision();
    const after = new Date();

    const status = await getOperationalSupervisionSchedulerStatus();
    assert.ok(status.lastStartedAt);
    assert.ok(status.lastCompletedAt);
    assert.ok(new Date(status.lastStartedAt!).getTime() >= before.getTime());
    assert.ok(new Date(status.lastCompletedAt!).getTime() <= after.getTime());
    assert.equal(status.lastResult, 'success');
    assert.ok(status.lastDurationMs !== null && status.lastDurationMs >= 0);
  });

  test('25: status mostra running=true durante a execução', async () => {
    await setOperationalSupervisionEnabled(true);

    const tickPromise = runScheduledOperationalSupervision(
      () => new Promise((resolve) => setTimeout(() => resolve(fakeReport()), 150)),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusDuring = await getOperationalSupervisionSchedulerStatus();
    assert.equal(statusDuring.running, true);

    await tickPromise;
    const statusAfter = await getOperationalSupervisionSchedulerStatus();
    assert.equal(statusAfter.running, false);
  });

  test('28: lastFailedAt é atualizado quando o tick falha', async () => {
    await setOperationalSupervisionEnabled(true);

    await runScheduledOperationalSupervision(async () => {
      throw new Error('falha simulada para status');
    });

    const status = await getOperationalSupervisionSchedulerStatus();
    assert.ok(status.lastFailedAt);
    assert.equal(status.lastResult, 'failed');
  });

  test('30: intervalSeconds/active refletem o scheduler real quando iniciado', async () => {
    startOperationalSupervisionScheduler(90000);
    const status = await getOperationalSupervisionSchedulerStatus();
    assert.equal(status.active, true);
    assert.equal(status.intervalSeconds, 90);
    assert.ok(status.nextRunAt);
    stopOperationalSupervisionScheduler();
  });
});
