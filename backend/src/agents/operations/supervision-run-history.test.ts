import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalSupervisionRuns } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { getSupervisionRunById, listSupervisionRuns, runObservedOperationalSupervision } from './supervision-run-history.js';
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

function delayedRunner(delayMs: number, report: OperationalSupervisionReport) {
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return report;
  };
}

/*
 * Agentes v3.4 (correio.md "Operational Supervision Observability & Run
 * History", "19. Testes mínimos obrigatórios" — Persistência/Lock/
 * Contrato). Roda contra o Postgres de teste real — nenhum mock do
 * banco.
 */
describe('Agentes v3.4 - supervision-run-history (histórico persistente)', () => {
  let poolEndedByTest = false;

  after(async () => {
    if (!poolEndedByTest) await database.end();
    redis.disconnect();
  });

  test('1: run inicia como running (visível no banco antes mesmo do runner terminar)', async () => {
    let observedRunningRowExists = false;

    await runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'manual' }, async () => {
      const [row] = await db.select().from(agentOperationalSupervisionRuns).orderBy(desc(agentOperationalSupervisionRuns.id)).limit(1);
      observedRunningRowExists = row?.status === 'running' && row.finishedAt === null;
      return fakeReport();
    });

    assert.equal(observedRunningRowExists, true, 'o registro deveria existir com status=running ANTES do runner terminar — criado antes de tentar o lock');
  });

  test('2/5/6: sucesso termina succeeded — finished_at preenchido, duration_ms coerente (>= 0)', async () => {
    const report = await runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'manual' }, async () => fakeReport({ incidentsDetected: 4, failed: 0 }));

    const [row] = await db.select().from(agentOperationalSupervisionRuns).orderBy(desc(agentOperationalSupervisionRuns.id)).limit(1);
    assert.equal(row!.status, 'succeeded');
    assert.ok(row!.finishedAt !== null, 'finished_at deveria estar preenchido em estado terminal');
    assert.ok(row!.durationMs !== null && row!.durationMs >= 0, 'duration_ms deveria ser não-negativo');
    assert.equal(row!.findingsCount, 4);
    assert.equal(row!.responsesFailed, 0);

    // 10/11: contrato/relatório original intactos — o que o runner
    // devolveu é exatamente o que `runObservedOperationalSupervision`
    // devolve ao chamador, sem nenhuma interceptação/mutação.
    assert.equal(report.incidentsDetected, 4);
  });

  test('3: relatório com falhas isoladas (v3.2, report.failed > 0) termina completed_with_failures — nunca "failed" puro', async () => {
    await runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'manual' }, async () => fakeReport({ incidentsDetected: 3, failed: 1 }));

    const [row] = await db.select().from(agentOperationalSupervisionRuns).orderBy(desc(agentOperationalSupervisionRuns.id)).limit(1);
    assert.equal(row!.status, 'completed_with_failures', 'uma falha ISOLADA de incidente (v3.2) nunca deve ser confundida com falha ESTRUTURAL do scan');
    assert.equal(row!.failedCount, 1);
    assert.equal(row!.responsesFailed, 1);
  });

  test('4: falha estrutural do runner termina "failed" — erro original continua propagando para o chamador', async () => {
    await assert.rejects(
      () => runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'manual' }, async () => { throw new Error('falha estrutural simulada'); }),
      /falha estrutural simulada/,
    );

    const [row] = await db.select().from(agentOperationalSupervisionRuns).orderBy(desc(agentOperationalSupervisionRuns.id)).limit(1);
    assert.equal(row!.status, 'failed');
    assert.ok(row!.errorMessage?.includes('falha estrutural simulada'));
    assert.ok(row!.finishedAt !== null);
  });

  test('7/8: lock ocupado produz skipped_already_running; o runner concorrente NUNCA executa', async () => {
    let secondRunnerCalled = false;

    const first = runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'scheduler' }, delayedRunner(150, fakeReport()));
    await new Promise((resolve) => setTimeout(resolve, 30));

    await assert.rejects(
      () =>
        runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'manual' }, async () => {
          secondRunnerCalled = true;
          return fakeReport();
        }),
      (error: unknown) => error instanceof Error && error.name === 'SupervisionAlreadyRunningError',
    );

    assert.equal(secondRunnerCalled, false, 'o runner da tentativa rejeitada NUNCA deveria ter sido chamado');

    const [skippedRow] = await db.select().from(agentOperationalSupervisionRuns).orderBy(desc(agentOperationalSupervisionRuns.id)).limit(1);
    assert.equal(skippedRow!.status, 'skipped_already_running');
    assert.equal(skippedRow!.triggerSource, 'manual');

    await first;
  });

  test('12/13: API — listSupervisionRuns pagina, filtra por status/triggerSource, e ordena por started_at DESC', async () => {
    await runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'manual' }, async () => fakeReport({ failed: 0 }));
    await runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'scheduler' }, async () => fakeReport({ failed: 1 }));

    const { rows } = await listSupervisionRuns({ page: 1, limit: 5 });
    assert.ok(rows.length >= 2);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i - 1]!.startedAt.getTime() >= rows[i]!.startedAt.getTime(), 'listagem deveria estar ordenada por started_at DESC');
    }

    const succeededOnly = await listSupervisionRuns({ page: 1, limit: 20, status: 'succeeded' });
    assert.ok(succeededOnly.rows.every((row) => row.status === 'succeeded'));

    const schedulerOnly = await listSupervisionRuns({ page: 1, limit: 20, triggerSource: 'scheduler' });
    assert.ok(schedulerOnly.rows.every((row) => row.triggerSource === 'scheduler'));

    const [firstRow] = rows;
    const detail = await getSupervisionRunById(firstRow!.id);
    assert.equal(detail?.id, firstRow!.id);

    assert.equal(await getSupervisionRunById(999999999), null);
  });

  test('9: Postgres genuinamente indisponível nunca vira skipped_already_running/sucesso — o erro original propaga (último teste: encerra o pool de propósito)', async () => {
    // Com o pool encerrado, `createSupervisionRun` (o INSERT inicial, ANTES
    // até de tentar o advisory lock) já falha — o mesmo tipo de
    // indisponibilidade que, em produção, também impediria
    // `pg_try_advisory_lock` de rodar (é o MESMO Postgres). Correio.md
    // seção 7: "não forçar uma gravação no mesmo PostgreSQL se o banco
    // está indisponível... propagar o erro original normalmente" — este
    // teste prova exatamente isso: nenhuma tentativa de "salvar de
    // qualquer jeito" mascara a indisponibilidade, e o erro nunca é
    // confundido com `SupervisionAlreadyRunningError`.
    poolEndedByTest = true;
    await database.end();

    await assert.rejects(
      () => runObservedOperationalSupervision({ actorUserId: null, triggeredBy: 'manual' }, async () => fakeReport()),
      (error: unknown) => !(error instanceof Error) || error.name !== 'SupervisionAlreadyRunningError',
    );
  });
});
