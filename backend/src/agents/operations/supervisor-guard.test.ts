import assert from 'node:assert/strict';
import { after, test, describe } from 'node:test';

import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import {
  isOperationalSupervisionRunning,
  OPERATIONAL_SUPERVISION_LOCK_KEY,
  runGuardedOperationalSupervision,
  setForcedUnlockFailureForTests,
  SupervisionAlreadyRunningError,
} from './supervisor-guard.js';
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

/** Confirma, via `pg_try_advisory_lock`, se o lock está livre AGORA — usando uma conexão dedicada nova, nunca a mesma do guard sob teste. */
async function lockIsFreeRightNow(): Promise<boolean> {
  const client = await database.connect();
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
    const acquired = result.rows[0]?.acquired === true;
    if (acquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
    }
    return acquired;
  } finally {
    client.release();
  }
}

/*
 * Agentes v2.5.1/v3.3 (correio.md "Distributed Operational Supervision
 * Locking") — o guard central único (supervisor-guard.ts), agora também
 * coordenado por um PostgreSQL advisory lock real (não só um `runner`
 * injetado em memória): estes testes rodam contra o Postgres de teste de
 * verdade, provando exclusão mútua tanto local (fast-path) quanto
 * cross-connection (o cenário que realmente motivou a v3.3).
 */
describe('Agentes v2.5.1/v3.3 - supervisor-guard (guard central + advisory lock)', () => {
  // v3.3 item 8 (falha de infraestrutura ao adquirir o lock) precisa
  // encerrar o pool compartilhado do processo de propósito — por isso é
  // o ÚLTIMO teste deste arquivo, e este `after()` evita chamar
  // `database.end()` de novo sobre um pool que aquele teste já encerrou.
  let poolEndedByTest = false;

  after(async () => {
    if (!poolEndedByTest) await database.end();
    redis.disconnect();
  });

  test('1/6/13: primeira execução adquire o lock e executa o runner de verdade; guard fica livre depois', async () => {
    assert.equal(isOperationalSupervisionRunning(), false);
    const report = await runGuardedOperationalSupervision({ actorUserId: null }, async () => fakeReport({ incidentsDetected: 3 }));
    assert.equal(report.incidentsDetected, 3, 'o runner real deveria ter sido chamado e seu resultado devolvido sem alteração');
    assert.equal(isOperationalSupervisionRunning(), false);
  });

  test('7: guard fica livre novamente mesmo quando a supervisão lança exceção (falha estrutural do runner)', async () => {
    assert.equal(isOperationalSupervisionRunning(), false);
    await assert.rejects(() => runGuardedOperationalSupervision({ actorUserId: null }, throwingRunner('falha simulada')), /falha simulada/);
    assert.equal(isOperationalSupervisionRunning(), false);
  });

  test('4/9: uma chamada normal após uma falha anterior funciona normalmente (guard não fica preso)', async () => {
    await assert.rejects(() => runGuardedOperationalSupervision({ actorUserId: null }, throwingRunner('falha 1')));
    const report = await runGuardedOperationalSupervision({ actorUserId: null }, async () => fakeReport({ incidentsDetected: 5 }));
    assert.equal(report.incidentsDetected, 5);
  });

  test('1 (v3.3.1): unlock normal — lock é liberado após sucesso, conexão volta ao pool, outra sessão consegue adquirir a mesma chave', async () => {
    await runGuardedOperationalSupervision({ actorUserId: null }, async () => fakeReport());
    assert.ok(await lockIsFreeRightNow(), 'uma sessão PostgreSQL totalmente nova deveria conseguir adquirir o lock depois de uma execução bem-sucedida');
  });

  test('6/7 (lock): o advisory lock também é liberado depois de uma falha estrutural do runner — nunca fica preso no Postgres', async () => {
    await assert.rejects(() => runGuardedOperationalSupervision({ actorUserId: null }, throwingRunner('falha estrutural')));
    assert.ok(await lockIsFreeRightNow(), 'mesmo após o runner lançar, o lock deveria ter sido liberado no Postgres, não só a flag local');
  });

  test('2 (v3.3.1): falha FORÇADA em pg_advisory_unlock → conexão problemática é DESCARTADA (nunca devolvida saudável); uma sessão nova consegue adquirir o mesmo lock depois', async () => {
    setForcedUnlockFailureForTests(true);
    const report = await runGuardedOperationalSupervision({ actorUserId: null }, async () => fakeReport({ incidentsDetected: 7 }));
    assert.equal(report.incidentsDetected, 7, 'o runner deveria ter executado e devolvido seu resultado normalmente — só o UNLOCK falhou depois, nunca a execução em si');
    assert.equal(isOperationalSupervisionRunning(), false, 'guard local libera normalmente mesmo quando o unlock falha');

    // A prova real (correio.md "Testes obrigatórios" #2): se a conexão
    // problemática tivesse voltado "saudável" ao pool
    // (`client.release()` sem argumento), ela continuaria segurando o
    // lock de sessão de verdade no Postgres — uma tentativa nova
    // encontraria `acquired: false`. Como ela foi DESCARTADA
    // (`client.release(unlockError)`, o mecanismo oficial do driver
    // `pg`), o Postgres já removeu os locks daquela sessão junto com o
    // encerramento da conexão — uma sessão totalmente nova consegue
    // adquirir o MESMO lock imediatamente.
    assert.ok(await lockIsFreeRightNow(), 'depois do unlock falhar e a conexão ser descartada, uma sessão nova deveria conseguir adquirir o mesmo lock imediatamente — nunca um bloqueio falso/indefinido');
  });

  test('3 (v3.3.1): runner lança erro estrutural A + unlock também falha (erro B) → A é o erro que propaga (nunca B), conexão é descartada mesmo assim', async () => {
    setForcedUnlockFailureForTests(true);

    await assert.rejects(
      () => runGuardedOperationalSupervision({ actorUserId: null }, throwingRunner('erro estrutural do runner (A)')),
      (error: unknown) => {
        // A precedência é garantida pela semântica nativa de
        // try/finally do JavaScript: o `catch` interno do unlock nunca
        // relança `unlockError` (erro B) — só o registra — então o
        // `finally` inteiro completa sem lançar, e a exceção ORIGINAL
        // (A, ainda pendente do `try` de `runner(params)`) é a que
        // continua se propagando.
        assert.ok(error instanceof Error);
        assert.match((error as Error).message, /erro estrutural do runner \(A\)/, 'o erro que propaga precisa ser A (do runner), nunca B (do unlock, que é só registrado)');
        return true;
      },
    );

    assert.ok(await lockIsFreeRightNow(), 'mesmo com runner E unlock falhando ao mesmo tempo, a conexão deveria ter sido descartada e o lock liberado por consequência — nunca um bloqueio operacional indefinido');
  });

  test('2/3/5/11/12: duas chamadas concorrentes → só a primeira executa de verdade, a segunda recebe SupervisionAlreadyRunningError (nunca erro genérico)', async () => {
    const first = runGuardedOperationalSupervision({ actorUserId: null }, delayedRunner(150, fakeReport({ incidentsDetected: 1 })));

    // Pequeno atraso para garantir que `first` já adquiriu o guard antes
    // de `second` tentar — ordena os disparos no teste (o guard em si
    // não depende disso: a exclusão real vem do advisory lock).
    await new Promise((resolve) => setTimeout(resolve, 30));

    await assert.rejects(
      () => runGuardedOperationalSupervision({ actorUserId: null }, delayedRunner(50, fakeReport({ incidentsDetected: 2 }))),
      (error: unknown) => error instanceof SupervisionAlreadyRunningError,
    );

    const firstResult = await first;
    assert.equal(firstResult.incidentsDetected, 1, 'só a primeira chamada deveria ter executado de verdade — simula scheduler + manual concorrentes (nenhum branch especial por origem)');
    assert.equal(isOperationalSupervisionRunning(), false, 'guard deveria estar livre após a primeira terminar');
  });

  test('running reflete o estado real durante a execução', async () => {
    const promise = runGuardedOperationalSupervision({ actorUserId: null }, delayedRunner(80, fakeReport()));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(isOperationalSupervisionRunning(), true);
    await promise;
    assert.equal(isOperationalSupervisionRunning(), false);
  });

  test('22: o guard distribuído não altera o contrato/comportamento de runOperationalSupervision (v3.2 preservado) — runner padrão real é chamado sem transformação', async () => {
    // Usa o runner PADRÃO real (não injetado) — prova que o guard, ao
    // integrar o advisory lock, continua tratando `runner` como uma
    // caixa-preta: não inspeciona nem altera o relatório da v3.2 (campo
    // `failed`, por exemplo, continua presente e do tipo certo).
    const report = await runGuardedOperationalSupervision({ dryRun: false, actorUserId: null });
    assert.equal(typeof report.failed, 'number', 'contrato da v3.2 (campo aditivo failed) continua intacto através do guard distribuído');
    assert.equal(isOperationalSupervisionRunning(), false);
    assert.ok(await lockIsFreeRightNow());
  });

  test('20/21: prova real com DUAS CONEXÕES PostgreSQL distintas — connection A trava, B falha, A libera, B consegue', async () => {
    // correio.md seções 20/21 — "um teste que apenas chama duas Promises
    // no mesmo módulo com uma variável global local NÃO prova locking
    // distribuído". Este teste não passa nem perto de
    // `runGuardedOperationalSupervision` — opera diretamente em duas
    // `PoolClient`s (duas sessões PostgreSQL reais, cada uma com seu
    // próprio backend PID) usando a MESMA chave de lock de produção
    // (`OPERATIONAL_SUPERVISION_LOCK_KEY`, exportada só para isto).
    const clientA = await database.connect();
    const clientB = await database.connect();

    try {
      const pidA = (await clientA.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pidB = (await clientB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      assert.notEqual(pidA, pidB, 'A e B precisam ser sessões PostgreSQL DISTINTAS — senão isto provaria só exclusão dentro do mesmo processo/conexão, não cross-process');

      const lockA = await clientA.query('SELECT pg_try_advisory_lock($1) AS acquired', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
      assert.equal(lockA.rows[0].acquired, true, 'A deveria conseguir o lock — ninguém mais o detém');

      const lockB = await clientB.query('SELECT pg_try_advisory_lock($1) AS acquired', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
      assert.equal(lockB.rows[0].acquired, false, 'B (sessão DIFERENTE) não deveria conseguir o mesmo lock enquanto A o detém — isto é a garantia cross-process real');

      await clientA.query('SELECT pg_advisory_unlock($1)', [OPERATIONAL_SUPERVISION_LOCK_KEY]);

      const lockB2 = await clientB.query('SELECT pg_try_advisory_lock($1) AS acquired', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
      assert.equal(lockB2.rows[0].acquired, true, 'depois que A libera, B (a MESMA sessão que falhou antes) deveria conseguir adquirir agora');

      await clientB.query('SELECT pg_advisory_unlock($1)', [OPERATIONAL_SUPERVISION_LOCK_KEY]);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  test('8: falha de infraestrutura ao TENTAR o lock propaga como erro estrutural — nunca SupervisionAlreadyRunningError (último teste: encerra o pool de propósito)', async () => {
    poolEndedByTest = true;
    await database.end();

    await assert.rejects(
      () => runGuardedOperationalSupervision({ actorUserId: null }, async () => fakeReport()),
      (error: unknown) => {
        // Precisa lançar (o pool está genuinamente indisponível — mesma
        // classe de falha que "Postgres fora do ar"), mas NUNCA como
        // `SupervisionAlreadyRunningError` (correio.md seção 9: "nunca
        // transformar indisponibilidade do banco em already_running").
        assert.ok(!(error instanceof SupervisionAlreadyRunningError), 'falha de infraestrutura nunca pode ser confundida com lock ocupado');
        return true;
      },
    );
  });
});
