import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentAutonomyBlocks,
  agentEvents,
  agentJobRuns,
  agentJobs,
  agents,
  auditLogs,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { setAutonomousExecutionEnabled } from './global-switch.js';
import { runAgentJob } from './job-runner.js';

/**
 * Agentes v1.5 — Autonomy Guard / Circuit Breaker (correio.md seções
 * 5/6/7/8/9/10/24). Testes adversariais e de contorno, todos passando
 * pelo caminho real (`runAgentJob`, a mesma função de produção — nunca um
 * segundo mecanismo de teste).
 *
 * Fixture técnica usada nos testes de depth/cycle/chain-budget: em vez de
 * rodar o LLM/planner/tools de verdade para produzir "o Run seguinte
 * publicou um evento" (§13/14), inserimos diretamente uma linha em
 * agent_events com `caused_by_run_id`/`root_execution_id`/`autonomy_depth`
 * já preenchidos, simulando exatamente o que
 * agents/events/publisher.ts teria gravado se uma tool tivesse rodado
 * dentro daquele Run. `runAgentJob` nunca sabe a diferença — ele só lê a
 * linha (agents/jobs/job-runner.ts busca `agent_events` por id antes da
 * transação), então isso exercita o Autonomy Guard de ponta a ponta sem
 * precisar de AGENT_LLM_ENABLED=true nem de um domínio real.
 */
describe('Autonomy Guard (Agentes v1.5 — correio.md seções 5/6/7/8/9/10/24)', () => {
  const runId = Date.now();
  let ceoUserId: number;
  let directorAgentId: number;

  const createdJobIds: number[] = [];
  const createdEventIds: number[] = [];

  async function createJob(overrides: Partial<typeof agentJobs.$inferInsert> = {}) {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Job autonomy ${runId}-${Math.random().toString(36).slice(2, 8)}`,
        objective: 'Objetivo de teste do autonomy guard',
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'internal_event',
        maxRunsPerDay: 1000,
        maxActionsPerRun: 10,
        maxOpenApprovals: 10,
        timeoutSeconds: 60,
        shadowMode: false,
        allowConcurrentRuns: true,
        ...overrides,
      })
      .returning();

    createdJobIds.push(job.id);
    return job;
  }

  // Insere um evento "causador" fabricado (ver comentário do describe) —
  // nunca via publishAgentEvent (que validaria o payload contra o
  // catálogo); aqui só precisamos das 3 colunas de lineage.
  async function fabricateCausingEvent(lineage: { causedByRunId: number; rootExecutionId: number; autonomyDepth: number }) {
    const [event] = await db
      .insert(agentEvents)
      .values({
        eventType: 'agent.job.completed',
        eventVersion: 1,
        payload: { jobId: 1, runId: 1 },
        status: 'processed',
        causedByRunId: lineage.causedByRunId,
        rootExecutionId: lineage.rootExecutionId,
        autonomyDepth: lineage.autonomyDepth,
      })
      .returning();

    createdEventIds.push(event.id);
    return event;
  }

  async function runInternalEvent(jobId: number, eventId: number) {
    return runAgentJob(jobId, { type: 'internal_event', payload: { eventId } });
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    assert.ok(ceoEmail, 'CEO_EMAIL precisa estar definido.');

    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;

    // Mesmo racional de agents/events/event-processor.test.ts — o ambiente
    // deste repositório roda com AGENT_LLM_ENABLED=true no .env (chave
    // real de provider configurada). Este describe precisa do
    // planejamento determinístico e sem custo/latência de rede — não do
    // LLM de verdade — então força AGENT_LLM_ENABLED de volta ao default
    // seguro (false) para toda a suíte.
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;
  });

  afterEach(async () => {
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;
    delete process.env.AGENT_MAX_AUTONOMY_DEPTH;
    delete process.env.AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN;
    delete process.env.AGENT_JOB_AUTONOMY_RATE_LIMIT;
    delete process.env.AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS;
    delete process.env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS;
    await setAutonomousExecutionEnabled(true);

    if (createdJobIds.length > 0) {
      // cascade: agent_job_runs, agent_event_rules, agent_autonomy_blocks
      // (FK job_id onDelete cascade/set null conforme schema).
      await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));
      createdJobIds.length = 0;
    }

    if (createdEventIds.length > 0) {
      await db.delete(agentEvents).where(inArray(agentEvents.id, createdEventIds));
      createdEventIds.length = 0;
    }
  });

  after(async () => {
    await database.end();
    redis.disconnect();
  });

  test('manual sempre ignora o guard (depth/cycle/budget/rate/circuit nunca avaliados)', async () => {
    process.env.AGENT_MAX_AUTONOMY_DEPTH = '1';
    const job = await createJob();

    const result = await runAgentJob(job.id, { type: 'manual' }, ceoUserId);
    assert.ok(result.ok);
    assert.equal(result.run.autonomyDepth, 0);
    assert.equal(result.run.rootExecutionId, result.run.id);
  });

  test('depth: MAX_DEPTH=3 permite 0→1→2→3 e bloqueia o 4º nível', async () => {
    process.env.AGENT_MAX_AUTONOMY_DEPTH = '3';
    const job = await createJob();

    // root_execution_id/causation_run_id são self-FK reais (integridade de
    // verdade, não só em código) — a fixture precisa de um Run real para
    // apontar; o valor de autonomy_depth do evento fabricado é que decide
    // o cenário, não a profundidade real do Run âncora.
    const anchorJob = await createJob();
    const anchorRun = await runAgentJob(anchorJob.id, { type: 'schedule' });
    assert.ok(anchorRun.ok);
    const anchorId = anchorRun.run.id;

    // depth 3 permitido (causador tem depth=2 → next=3).
    const causingAtDepth2 = await fabricateCausingEvent({ causedByRunId: anchorId, rootExecutionId: anchorId, autonomyDepth: 2 });
    const allowed = await runInternalEvent(job.id, causingAtDepth2.id);
    assert.ok(allowed.ok, 'depth 3 deveria ser permitido com MAX_DEPTH=3');
    assert.equal(allowed.run.autonomyDepth, 3);

    // depth 4 bloqueado (causador tem depth=3 → next=4 > 3).
    const causingAtDepth3 = await fabricateCausingEvent({ causedByRunId: anchorId, rootExecutionId: anchorId, autonomyDepth: 3 });
    const blocked = await runInternalEvent(job.id, causingAtDepth3.id);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'autonomy_depth_exceeded');

    const [block] = await db
      .select()
      .from(agentAutonomyBlocks)
      .where(eq(agentAutonomyBlocks.jobId, job.id));
    assert.equal(block.reason, 'autonomy_depth_exceeded');
    assert.equal(block.attemptedDepth, 4);
    assert.equal(block.limitValue, 3);
  });

  test('cycle direto: A → A é bloqueado', async () => {
    const jobA = await createJob();

    // Run raiz "manual"-like via schedule (fresh root, depth 0).
    const rootRun = await runAgentJob(jobA.id, { type: 'schedule' });
    assert.ok(rootRun.ok);
    const rootId = rootRun.run.rootExecutionId!;

    const eventFromRoot = await fabricateCausingEvent({ causedByRunId: rootRun.run.id, rootExecutionId: rootId, autonomyDepth: 0 });
    const secondAttempt = await runInternalEvent(jobA.id, eventFromRoot.id);

    assert.equal(secondAttempt.ok, false);
    assert.equal(secondAttempt.code, 'autonomous_cycle_detected');
  });

  test('cycle indireto: A → B → A é bloqueado na volta para A', async () => {
    const jobA = await createJob();
    const jobB = await createJob();

    const rootRun = await runAgentJob(jobA.id, { type: 'schedule' });
    assert.ok(rootRun.ok);
    const rootId = rootRun.run.rootExecutionId!;

    const eventToB = await fabricateCausingEvent({ causedByRunId: rootRun.run.id, rootExecutionId: rootId, autonomyDepth: 0 });
    const runB = await runInternalEvent(jobB.id, eventToB.id);
    assert.ok(runB.ok, 'B deveria rodar normalmente (primeira vez nesta cadeia)');
    assert.equal(runB.run.autonomyDepth, 1);

    const eventBackToA = await fabricateCausingEvent({ causedByRunId: runB.run.id, rootExecutionId: rootId, autonomyDepth: 1 });
    const backToA = await runInternalEvent(jobA.id, eventBackToA.id);

    assert.equal(backToA.ok, false);
    assert.equal(backToA.code, 'autonomous_cycle_detected');
  });

  test('cycle mais longo: A → B → C → A é bloqueado na volta para A', async () => {
    const jobA = await createJob();
    const jobB = await createJob();
    const jobC = await createJob();

    const rootRun = await runAgentJob(jobA.id, { type: 'schedule' });
    assert.ok(rootRun.ok);
    const rootId = rootRun.run.rootExecutionId!;

    const eventToB = await fabricateCausingEvent({ causedByRunId: rootRun.run.id, rootExecutionId: rootId, autonomyDepth: 0 });
    const runB = await runInternalEvent(jobB.id, eventToB.id);
    assert.ok(runB.ok);

    const eventToC = await fabricateCausingEvent({ causedByRunId: runB.run.id, rootExecutionId: rootId, autonomyDepth: 1 });
    const runC = await runInternalEvent(jobC.id, eventToC.id);
    assert.ok(runC.ok);

    const eventBackToA = await fabricateCausingEvent({ causedByRunId: runC.run.id, rootExecutionId: rootId, autonomyDepth: 2 });
    const backToA = await runInternalEvent(jobA.id, eventBackToA.id);

    assert.equal(backToA.ok, false);
    assert.equal(backToA.code, 'autonomous_cycle_detected');
  });

  test('chain budget: MAX_RUNS=5 bloqueia a 6ª execução da mesma cadeia', async () => {
    process.env.AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN = '5';

    // 6 Jobs distintos encadeados na mesma raiz — nunca repete o mesmo Job
    // (evitaria cruzar com cycle detection e testar a coisa errada).
    const jobs = await Promise.all(Array.from({ length: 6 }, () => createJob()));

    const rootRun = await runAgentJob(jobs[0].id, { type: 'schedule' });
    assert.ok(rootRun.ok);
    const rootId = rootRun.run.rootExecutionId!;

    let previous = rootRun.run;

    for (let i = 1; i < 5; i += 1) {
      const causingEvent = await fabricateCausingEvent({
        causedByRunId: previous.id,
        rootExecutionId: rootId,
        autonomyDepth: previous.autonomyDepth,
      });
      const next = await runInternalEvent(jobs[i].id, causingEvent.id);
      assert.ok(next.ok, `Job #${i} deveria rodar (dentro do budget de 5)`);
      previous = next.run;
    }

    // 6ª tentativa (índice 5) — cadeia já tem 5 Runs, budget=5 → bloqueada.
    const overBudgetEvent = await fabricateCausingEvent({
      causedByRunId: previous.id,
      rootExecutionId: rootId,
      autonomyDepth: previous.autonomyDepth,
    });
    const blocked = await runInternalEvent(jobs[5].id, overBudgetEvent.id);

    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'autonomy_chain_budget_exceeded');

    const runsInChain = await db.select().from(agentJobRuns).where(eq(agentJobRuns.rootExecutionId, rootId));
    assert.equal(runsInChain.length, 5, 'a 6ª tentativa nunca deveria ter criado um Run.');
  });

  test('rate limit: 2 execuções autônomas / janela, a 3ª é bloqueada; manual nunca conta', async () => {
    process.env.AGENT_JOB_AUTONOMY_RATE_LIMIT = '2';
    process.env.AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS = '300';

    const job = await createJob();

    const first = await runAgentJob(job.id, { type: 'schedule' });
    assert.ok(first.ok);
    const second = await runAgentJob(job.id, { type: 'schedule' });
    assert.ok(second.ok);

    const third = await runAgentJob(job.id, { type: 'schedule' });
    assert.equal(third.ok, false);
    assert.equal(third.code, 'autonomous_rate_limit_exceeded');

    // Manual continua liberado mesmo com a janela autônoma esgotada.
    const manual = await runAgentJob(job.id, { type: 'manual' }, ceoUserId);
    assert.ok(manual.ok, 'execução manual nunca deve ser bloqueada pelo rate limit autônomo.');
  });

  test('job autonomy switch: job.autonomyEnabled=false bloqueia só triggers automáticos', async () => {
    const job = await createJob({ autonomyEnabled: false });

    const auto = await runAgentJob(job.id, { type: 'schedule' });
    assert.equal(auto.ok, false);
    assert.equal(auto.code, 'autonomy_job_disabled');

    const manual = await runAgentJob(job.id, { type: 'manual' }, ceoUserId);
    assert.ok(manual.ok, 'switch por Job nunca deve bloquear execução manual.');
  });

  test('global autonomy switch continua funcionando exatamente como v1.3/v1.4 (regressão)', async () => {
    const job = await createJob();
    await setAutonomousExecutionEnabled(false);

    const auto = await runAgentJob(job.id, { type: 'schedule' });
    assert.equal(auto.ok, false);
    assert.equal(auto.code, 'job_autonomy_disabled');

    const manual = await runAgentJob(job.id, { type: 'manual' }, ceoUserId);
    assert.ok(manual.ok);
  });

  test('circuit breaker: closed→open no threshold, bloqueado durante cooldown, half_open após cooldown, closed no sucesso', async () => {
    process.env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD = '3';
    process.env.AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS = '300';

    const job = await createJob();

    // AGENT_LLM_ENABLED está desligado neste describe (default) — todo Run
    // autônomo termina 'failed' (llm_unavailable) de forma determinística,
    // servindo como "falha autônoma" real para o circuito.
    //
    // `settings` (kill switch global) é uma linha de verdade compartilhada
    // no banco entre os processos de TODOS os arquivos de teste rodando em
    // paralelo (mesmo racional documentado em
    // agents/events/event-processor.test.ts) — outro arquivo pode
    // religar/desligar o switch global no meio deste loop. Reafirmar
    // "true" antes de cada tentativa (em vez de só uma vez no afterEach)
    // encolhe bastante essa janela sem mascarar um bloqueio real do
    // Autonomy Guard (só retenta quando o motivo é especificamente o
    // switch global, nunca para qualquer outro código).
    for (let i = 0; i < 3; i += 1) {
      await setAutonomousExecutionEnabled(true);
      let result = await runAgentJob(job.id, { type: 'schedule' });

      if (!result.ok && result.code === 'job_autonomy_disabled') {
        await setAutonomousExecutionEnabled(true);
        result = await runAgentJob(job.id, { type: 'schedule' });
      }

      assert.ok(result.ok, `tentativa ${i} deveria criar o Run (mesmo que ele termine failed)`);
      assert.equal(result.run.status, 'failed');
    }

    const [afterThreshold] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
    assert.equal(afterThreshold.circuitState, 'open');
    assert.equal(afterThreshold.circuitFailureCount, 3);

    // Bloqueado durante o cooldown.
    const duringCooldown = await runAgentJob(job.id, { type: 'schedule' });
    assert.equal(duringCooldown.ok, false);
    assert.equal(duringCooldown.code, 'autonomy_circuit_open');

    // Manual continua funcionando com o circuito aberto.
    const manualDuringOpen = await runAgentJob(job.id, { type: 'manual' }, ceoUserId);
    assert.ok(manualDuringOpen.ok, 'circuito autônomo aberto nunca deve bloquear execução manual.');

    // Expira o cooldown manualmente (evita esperar 300s de verdade).
    await db
      .update(agentJobs)
      .set({ circuitOpenedAt: new Date(Date.now() - 301 * 1000) })
      .where(eq(agentJobs.id, job.id));

    // A partir daqui o trial precisa ficar "em voo" tempo suficiente para
    // um segundo gatilho concorrente observar o estado half_open — um Run
    // com AGENT_LLM_ENABLED=false termina rápido demais (síncrono o
    // bastante para nunca dar essa janela). Provider mockado com um atraso
    // artificial simula a latência real de um provider de LLM, permitindo
    // testar a exclusão mútua do trial de verdade (não só o resultado
    // final) — mesmo padrão de mock de
    // agents/events/event-processor.test.ts, com delay adicionado.
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    const { setLLMProviderOverrideForTests } = await import('../llm/factory.js');
    setLLMProviderOverrideForTests({
      name: 'mock-delayed',
      async complete() {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { raw: { objective: 'o', summary: 's', actions: [] } };
      },
    });

    try {
      const [trialResult, concurrentResult] = await Promise.all([
        runAgentJob(job.id, { type: 'schedule' }),
        (async () => {
          // Dá tempo do primeiro gatilho vencer a corrida pelo lock da
          // linha do Job e commitar a transição para half_open antes deste
          // segundo tentar.
          await new Promise((resolve) => setTimeout(resolve, 30));
          return runAgentJob(job.id, { type: 'schedule' });
        })(),
      ]);

      assert.ok(trialResult.ok, 'o trial pós-cooldown deveria ser permitido (half_open).');
      assert.equal(trialResult.run.status, 'completed', 'plano vazio mockado finaliza completed sem itens.');

      assert.equal(concurrentResult.ok, false);
      assert.equal(
        concurrentResult.code,
        'autonomy_circuit_open',
        'um segundo gatilho durante o trial (half_open) deve ser bloqueado — só uma tentativa controlada por vez.',
      );
    } finally {
      setLLMProviderOverrideForTests(null);
      delete process.env.AGENT_LLM_ENABLED;
      delete process.env.AGENT_LLM_SHADOW_MODE;
    }

    // O sucesso do trial já fechou o circuito de verdade (via
    // syncJobRunStatus → recordAutonomousOutcome, dentro do próprio
    // runAgentJob acima) — nenhuma chamada manual adicional necessária.
    const [closed] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
    assert.equal(closed.circuitState, 'closed');
    assert.equal(closed.circuitFailureCount, 0);
  });

  test('dead-letter: bloqueio não cria Run, mas grava agent_autonomy_blocks + audit', async () => {
    process.env.AGENT_MAX_AUTONOMY_DEPTH = '1';
    const job = await createJob();

    const causing = await fabricateCausingEvent({ causedByRunId: 1, rootExecutionId: 1, autonomyDepth: 1 });
    const blocked = await runInternalEvent(job.id, causing.id);
    assert.equal(blocked.ok, false);

    const runsForJob = await db.select().from(agentJobRuns).where(eq(agentJobRuns.jobId, job.id));
    assert.equal(runsForJob.length, 0, 'um bloqueio nunca deve criar um Run.');

    const blocks = await db.select().from(agentAutonomyBlocks).where(eq(agentAutonomyBlocks.jobId, job.id));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].reason, 'autonomy_depth_exceeded');

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, String(blocks[0].id)));
    assert.ok(
      auditRows.some((row) => row.action === 'agent_autonomy.blocked' && row.entityType === 'agent_autonomy_block'),
      'bloqueio deveria gerar um audit log agent_autonomy.blocked.',
    );
  });

  test('lineage: raiz nova aponta root_execution_id para o próprio id; cadeia herda o mesmo root', async () => {
    const job = await createJob();
    const child = await createJob();

    const root = await runAgentJob(job.id, { type: 'schedule' });
    assert.ok(root.ok);
    assert.equal(root.run.rootExecutionId, root.run.id);
    assert.equal(root.run.causationRunId, null);
    assert.equal(root.run.autonomyDepth, 0);

    const causingEvent = await fabricateCausingEvent({
      causedByRunId: root.run.id,
      rootExecutionId: root.run.rootExecutionId!,
      autonomyDepth: 0,
    });
    const next = await runInternalEvent(child.id, causingEvent.id);
    assert.ok(next.ok);
    assert.equal(next.run.rootExecutionId, root.run.rootExecutionId);
    assert.equal(next.run.causationRunId, root.run.id);
    assert.equal(next.run.autonomyDepth, 1);
  });

  // Concorrência (correio.md seção 23) — "esta versão será considerada
  // incorreta se as proteções funcionarem apenas em execução serial".

  test('concorrência: chain budget nunca é ultrapassado com vários Jobs disputando a mesma raiz ao mesmo tempo', async () => {
    process.env.AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN = '3';

    const jobs = await Promise.all(Array.from({ length: 6 }, () => createJob()));
    const rootRun = await runAgentJob(jobs[0].id, { type: 'schedule' });
    assert.ok(rootRun.ok);
    const rootId = rootRun.run.rootExecutionId!;

    // 5 Jobs distintos disputando as 2 vagas restantes (budget=3, raiz já
    // ocupa 1) — todos "causados" pelo mesmo Run raiz, disparados em
    // paralelo de propósito (Promise.all).
    const contenders = jobs.slice(1);
    const results = await Promise.all(
      contenders.map(async (job) => {
        const causingEvent = await fabricateCausingEvent({
          causedByRunId: rootRun.run.id,
          rootExecutionId: rootId,
          autonomyDepth: 0,
        });
        return runInternalEvent(job.id, causingEvent.id);
      }),
    );

    const succeeded = results.filter((result) => result.ok);
    const blocked = results.filter((result) => !result.ok);

    assert.equal(succeeded.length, 2, 'só 2 das 5 tentativas concorrentes deveriam caber no budget restante.');
    assert.ok(blocked.every((result) => !result.ok && result.code === 'autonomy_chain_budget_exceeded'));

    const runsInChain = await db.select().from(agentJobRuns).where(eq(agentJobRuns.rootExecutionId, rootId));
    assert.equal(runsInChain.length, 3, 'a contagem final na cadeia nunca pode passar do budget configurado.');
  });

  test('concorrência: rate limit por Job nunca é ultrapassado com disparos simultâneos', async () => {
    process.env.AGENT_JOB_AUTONOMY_RATE_LIMIT = '2';
    process.env.AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS = '300';

    const job = await createJob();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => runAgentJob(job.id, { type: 'schedule' })),
    );

    const succeeded = results.filter((result) => result.ok);
    const blocked = results.filter((result) => !result.ok);

    assert.equal(succeeded.length, 2, 'só 2 das 5 tentativas concorrentes deveriam caber no rate limit.');
    assert.ok(blocked.every((result) => !result.ok && result.code === 'autonomous_rate_limit_exceeded'));

    const runsForJob = await db.select().from(agentJobRuns).where(eq(agentJobRuns.jobId, job.id));
    assert.equal(runsForJob.length, 2);
  });

  test('concorrência: circuit breaker atinge o threshold de forma consistente sob falhas simultâneas', async () => {
    process.env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD = '3';
    process.env.AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS = '300';

    const job = await createJob();

    // 5 tentativas simultâneas, todas falhando (LLM desligado). Diferente
    // de chain budget/rate limit, a decisão do circuito na criação
    // (guard) e a reação à falha na finalização (recordAutonomousOutcome)
    // são duas transações separadas no tempo (a criação libera o lock da
    // linha do Job antes do Run terminar de fato) — então, sob
    // concorrência real, é legítimo que algumas das 5 tentativas cheguem a
    // ver o circuito já 'open' e sejam bloqueadas na própria criação, não
    // só na finalização. A invariante que precisa se manter (e é isso que
    // este teste verifica) é: nenhum incremento de falha é perdido — o
    // contador final é exatamente igual ao número de Runs que de fato
    // foram criados (agents/autonomy/circuit.ts trava a linha do Job por
    // transação a cada finalização, sem lost update).
    const results = await Promise.all(
      Array.from({ length: 5 }, () => runAgentJob(job.id, { type: 'schedule' })),
    );

    const created = results.filter((result) => result.ok);
    const blockedByCircuit = results.filter((result) => !result.ok && result.code === 'autonomy_circuit_open');

    assert.equal(
      created.length + blockedByCircuit.length,
      5,
      'toda tentativa deveria ter sido criada ou bloqueada especificamente pelo circuito (nenhum outro motivo se aplica aqui).',
    );

    const [finalJob] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
    assert.equal(
      finalJob.circuitFailureCount,
      created.length,
      'o contador final deve bater exatamente com o número de Runs criados, sem perda por concorrência.',
    );
    assert.equal(finalJob.circuitState, created.length >= 3 ? 'open' : 'closed');
  });
});
