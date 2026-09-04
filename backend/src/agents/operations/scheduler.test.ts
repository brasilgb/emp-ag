import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq, gte } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { auditLogs, settings } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import {
  getSchedulerRuntimeState,
  runScheduledOperationalSupervision,
  startOperationalSupervisionScheduler,
  stopOperationalSupervisionScheduler,
} from './scheduler.js';
import { OPERATIONAL_SUPERVISION_SETTING_KEY, setOperationalSupervisionEnabled } from './scheduler-settings.js';
import { isOperationalSupervisionRunning } from './supervisor-guard.js';
import { env } from '../../config/env.js';
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

/*
 * Agentes v2.5.1 (correio.md seções 32/33/36) — scheduler/lifecycle/
 * failure isolation, usando `runner` injetado (nunca precisa de
 * infraestrutura real quebrando para provar isolamento de falha).
 */
describe('Agentes v2.5.1 - Operational Supervision Scheduler', () => {
  after(async () => {
    stopOperationalSupervisionScheduler();
    await db.delete(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY));
    await database.end();
    redis.disconnect();
  });

  describe('configuração de intervalo (correio.md v2.5.1 seção 34, item 4/20)', () => {
    test('3/20: intervalo configurado via env é respeitado', () => {
      process.env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS = '600';
      assert.equal(env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS, 600);
      delete process.env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS;
    });

    test('4: intervalo abaixo do mínimo (60s) é rejeitado — getter lança', () => {
      process.env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS = '10';
      assert.throws(() => env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS, />= 60/);
      delete process.env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS;
    });

    test('sem env definida, default seguro (300s) é usado', () => {
      delete process.env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS;
      assert.equal(env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS, 300);
    });
  });

  describe('runScheduledOperationalSupervision — comportamento por tick', () => {
    test('1: desabilitado (setting=false) → não executa o runner', async () => {
      await setOperationalSupervisionEnabled(false);
      let called = false;
      await runScheduledOperationalSupervision(async () => {
        called = true;
        return fakeReport();
      });
      assert.equal(called, false);
    });

    test('2: habilitado → executa o runner de verdade', async () => {
      await setOperationalSupervisionEnabled(true);
      let called = false;
      await runScheduledOperationalSupervision(async (options) => {
        called = true;
        assert.equal(options.triggeredBy, 'scheduler');
        assert.equal(options.dryRun, false);
        return fakeReport();
      });
      assert.equal(called, true);
    });

    test('8/9/28: exception do supervisor é isolada — auditada como scheduler.failed, guard libera, próximo tick funciona normalmente', async () => {
      await setOperationalSupervisionEnabled(true);
      const before = new Date();

      await runScheduledOperationalSupervision(async () => {
        throw new Error('falha simulada do supervisor');
      });

      assert.equal(isOperationalSupervisionRunning(), false, 'guard deveria ter sido liberado mesmo com exceção');

      const failedLogs = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.operations.scheduler.failed'), gte(auditLogs.createdAt, before)));
      assert.ok(failedLogs.length >= 1, 'deveria existir auditoria de scheduler.failed');
      const metadata = failedLogs[0]!.metadata as { message: string };
      assert.ok(metadata.message.includes('falha simulada'));

      // Próximo tick funciona normalmente (scheduler não ficou travado).
      let secondCalled = false;
      await runScheduledOperationalSupervision(async () => {
        secondCalled = true;
        return fakeReport();
      });
      assert.equal(secondCalled, true);
    });

    test('5: tick durante execução ativa é ignorado (skipped), auditado, nunca lança para o caller', async () => {
      await setOperationalSupervisionEnabled(true);
      const before = new Date();

      const slowRunner = () => new Promise<OperationalSupervisionReport>((resolve) => setTimeout(() => resolve(fakeReport()), 150));

      const firstTick = runScheduledOperationalSupervision(slowRunner);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Segundo tick concorrente — não deveria lançar (a função captura
      // SupervisionAlreadyRunningError internamente).
      await runScheduledOperationalSupervision(async () => fakeReport());

      const skippedLogs = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.operations.scheduler.skipped'), gte(auditLogs.createdAt, before)));
      assert.ok(skippedLogs.length >= 1, 'deveria existir auditoria de scheduler.skipped (overlap)');

      await firstTick;
    });

    test('desabilitado nunca gera auditoria de scheduler.skipped/failed (só ticks relevantes são auditados)', async () => {
      await setOperationalSupervisionEnabled(false);
      const before = new Date();

      await runScheduledOperationalSupervision(async () => fakeReport());

      const anyAudit = await db
        .select()
        .from(auditLogs)
        .where(and(gte(auditLogs.createdAt, before)));
      const opsAudits = anyAudit.filter((row) => row.action.startsWith('agents.operations.scheduler.'));
      assert.equal(opsAudits.length, 0, 'tick desabilitado não deveria gerar nenhum audit log de scheduler');
    });
  });

  describe('start/stop lifecycle (itens 31-35)', () => {
    test('31/32: start() é idempotente — chamar duas vezes não cria dois timers', async () => {
      startOperationalSupervisionScheduler(60000);
      const first = getSchedulerRuntimeState();
      startOperationalSupervisionScheduler(60000);
      const second = getSchedulerRuntimeState();

      assert.equal(first.active, true);
      assert.equal(second.active, true);
      // Mesmo estado (não recriou o timer com um novo `schedulerStartedAt`).
      assert.equal(first.nextRunAt?.getTime(), second.nextRunAt?.getTime());

      stopOperationalSupervisionScheduler();
    });

    test('33/34: stop() limpa o timer; stop() repetido é seguro (nunca lança)', async () => {
      startOperationalSupervisionScheduler(60000);
      assert.equal(getSchedulerRuntimeState().active, true);

      stopOperationalSupervisionScheduler();
      assert.equal(getSchedulerRuntimeState().active, false);

      // Repetir stop() não deveria lançar nem alterar nada.
      stopOperationalSupervisionScheduler();
      assert.equal(getSchedulerRuntimeState().active, false);
    });

    test('30: nextRunAt é coerente com o intervalo configurado', async () => {
      const intervalMs = 120000;
      const before = Date.now();
      startOperationalSupervisionScheduler(intervalMs);
      const state = getSchedulerRuntimeState();
      assert.ok(state.nextRunAt);
      const deltaMs = state.nextRunAt!.getTime() - before;
      assert.ok(deltaMs > intervalMs - 1000 && deltaMs < intervalMs + 1000, `nextRunAt deveria estar a ~${intervalMs}ms de distância, ficou a ${deltaMs}ms`);

      stopOperationalSupervisionScheduler();
    });

    test('inativo (nunca iniciado / já parado) → nextRunAt null, active false', async () => {
      stopOperationalSupervisionScheduler();
      const state = getSchedulerRuntimeState();
      assert.equal(state.active, false);
      assert.equal(state.nextRunAt, null);
    });
  });
});
