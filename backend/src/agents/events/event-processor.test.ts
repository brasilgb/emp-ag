import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentEventDeliveries,
  agentEventRules,
  agentEvents,
  agentJobRuns,
  agentJobs,
  agents,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../agents/llm/factory.js';
import { registerAllTools } from '../../agents/tools/index.js';
import type { LLMProvider, LLMResponse } from '../../agents/llm/types.js';
import { setAutonomousExecutionEnabled } from '../jobs/global-switch.js';
import { publishAgentEvent } from './publisher.js';
import { handleProcessingError, processNextEvent, recoverAbandonedEvents } from './event-processor.js';

// Drena a fila até o evento alvo sair de pending/processing (ou o limite
// de iterações). Necessário porque outros arquivos de teste, ao rodar em
// paralelo (node:test), também exercitam rotas de domínio agora
// instrumentadas (crm/leads, support/tickets, financial/entries...) — cada
// uma publica seus próprios agent_events 'pending' na mesma tabela.
// processNextEvent() sempre pega "o próximo pendente por received_at"
// (comportamento de produção correto: uma fila única) — em teste, isso
// significa que uma única chamada pode processar o evento de OUTRO
// arquivo, não o nosso. Drenar em loop até o nosso evento específico
// sair de pending/processing torna o teste correto independente de
// quantos eventos alheios existam na fila.
async function drainUntil(eventId: number, maxIterations = 2000): Promise<typeof agentEvents.$inferSelect> {
  for (let i = 0; i < maxIterations; i += 1) {
    const [current] = await db.select().from(agentEvents).where(eq(agentEvents.id, eventId));

    if (current.status !== 'pending' && current.status !== 'processing') {
      return current;
    }

    const outcome = await processNextEvent();

    if (outcome === 'no_event') {
      // Fila global vazia mas o nosso evento ainda pending/processing —
      // não deveria acontecer (só se outro teste o pegou e ainda não
      // terminou); espera um instante e tenta de novo.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  const [final] = await db.select().from(agentEvents).where(eq(agentEvents.id, eventId));
  return final;
}

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

const LEAD_PAYLOAD = {
  leadId: 999001,
  name: 'Lead teste processor',
  source: 'referral',
  status: 'open',
  probability: 80,
  pipelineStageId: 1,
  ownerUserId: null,
};

describe('Event Processor (Agentes v1.4 — correio.md seções 10/12/13/14/15)', () => {
  registerAllTools();

  const runId = Date.now();
  let ceoUserId: number;
  let directorAgentId: number;

  const createdEventIds: number[] = [];
  const createdRuleIds: number[] = [];
  const createdJobIds: number[] = [];

  async function createJob(overrides: Partial<typeof agentJobs.$inferInsert> = {}) {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Job event-driven ${runId}-${Math.random().toString(36).slice(2, 8)}`,
        objective: 'Objetivo de teste do event processor',
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'internal_event',
        maxRunsPerDay: 24,
        maxActionsPerRun: 10,
        maxOpenApprovals: 10,
        timeoutSeconds: 60,
        shadowMode: false,
        allowConcurrentRuns: false,
        ...overrides,
      })
      .returning();

    createdJobIds.push(job.id);
    return job;
  }

  async function createRule(jobId: number, overrides: Partial<typeof agentEventRules.$inferInsert> = {}) {
    const [rule] = await db
      .insert(agentEventRules)
      .values({
        name: `Rule ${runId}-${Math.random().toString(36).slice(2, 8)}`,
        eventType: 'crm.lead.created',
        eventVersion: 1,
        jobId,
        filters: {},
        enabled: true,
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();

    createdRuleIds.push(rule.id);
    return rule;
  }

  async function publishLeadEvent(payload: typeof LEAD_PAYLOAD = LEAD_PAYLOAD) {
    const event = await publishAgentEvent({
      type: 'crm.lead.created',
      aggregateType: 'crm.lead',
      aggregateId: payload.leadId,
      payload,
    });
    createdEventIds.push(event.id);
    return event;
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
  });

  // Isolamento entre testes: agentEventRules casa por event_type inteiro
  // (comportamento correto em produção — várias regras podem coexistir
  // para o mesmo tipo). Sem limpar job/rule a cada teste, uma rule
  // `filters: {}` de um teste anterior continuaria casando com os eventos
  // dos testes seguintes. Deletar rule/job em cascata (agent_event_deliveries
  // e agent_job_runs têm onDelete:'cascade' a partir de job/rule) já
  // limpa tudo que aquele teste criou.
  afterEach(async () => {
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;
    setLLMProviderOverrideForTests(null);
    await setAutonomousExecutionEnabled(true);

    if (createdRuleIds.length > 0) {
      await db.delete(agentEventRules).where(inArray(agentEventRules.id, createdRuleIds));
      createdRuleIds.length = 0;
    }

    if (createdJobIds.length > 0) {
      await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));
      createdJobIds.length = 0;
    }
  });

  after(async () => {
    if (createdEventIds.length > 0) await db.delete(agentEvents).where(inArray(agentEvents.id, createdEventIds));

    await database.end();
    redis.disconnect();
  });

  test('evento sem nenhuma rule cadastrada → ignored', async () => {
    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111001 });

    const reloaded = await drainUntil(event.id);
    assert.equal(reloaded.status, 'ignored');
  });

  test('evento com rule cujo filtro não casa → ignored, sem delivery', async () => {
    const job = await createJob();
    await createRule(job.id, { filters: { probability: { gte: 95 } } });

    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111002, probability: 40 });
    const reloaded = await drainUntil(event.id);
    assert.equal(reloaded.status, 'ignored');

    const deliveries = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(deliveries.length, 0);
  });

  test('evento com uma rule correspondente → processed, delivery triggered, Job Run criado via runAgentJob (pipeline v1.3)', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const job = await createJob();
    const rule = await createRule(job.id, { filters: { probability: { gte: 70 } } });

    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111003, probability: 80 });
    const reloaded = await drainUntil(event.id);
    assert.equal(reloaded.status, 'processed');

    const [delivery] = await db
      .select()
      .from(agentEventDeliveries)
      .where(and(eq(agentEventDeliveries.eventId, event.id), eq(agentEventDeliveries.ruleId, rule.id)));
    assert.equal(delivery.status, 'triggered');
    assert.ok(delivery.jobRunId);

    const [run] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, delivery.jobRunId!));
    assert.equal(run.triggerType, 'internal_event');
    assert.equal(run.status, 'completed');
  });

  test('evento com várias rules correspondentes → múltiplas deliveries', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const jobA = await createJob();
    const jobB = await createJob();
    await createRule(jobA.id, { filters: {} });
    await createRule(jobB.id, { filters: {} });

    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111004 });
    await drainUntil(event.id);

    const deliveries = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(deliveries.length, 2);
    assert.ok(deliveries.every((delivery) => delivery.status === 'triggered'));
  });

  test('rule disabled não dispara', async () => {
    const job = await createJob();
    await createRule(job.id, { filters: {}, enabled: false });

    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111005 });
    const reloaded = await drainUntil(event.id);

    const deliveries = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(deliveries.length, 0);
    assert.equal(reloaded.status, 'ignored');
  });

  test('Job paused não é disparado pelo evento — delivery failed com job_not_runnable', async () => {
    const job = await createJob({ status: 'paused' });
    await createRule(job.id, { filters: {} });

    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111006 });
    await drainUntil(event.id);

    const [delivery] = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.errorCode, 'job_not_runnable');

    // O evento em si ainda é 'processed' — a regra foi tentada, a falha
    // fica registrada na delivery, não trava o evento (correio.md seção 10).
    const [reloadedEvent] = await db.select().from(agentEvents).where(eq(agentEvents.id, event.id));
    assert.equal(reloadedEvent.status, 'processed');
  });

  test('Job cancelled não é disparado pelo evento', async () => {
    const job = await createJob({ status: 'cancelled' });
    await createRule(job.id, { filters: {} });

    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111007 });
    await drainUntil(event.id);

    const [delivery] = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.errorCode, 'job_not_runnable');
  });

  test('global autonomy switch desligado bloqueia o disparo (internal_event é tratado como automático)', async () => {
    const job = await createJob();
    await createRule(job.id, { filters: {} });

    // Esvazia a fila de qualquer evento pendente de OUTROS arquivos de
    // teste concorrentes antes de desligar o switch global: settings é
    // uma linha compartilhada de verdade (correio.md seção 17 — um único
    // switch global), e jobs.test.ts também liga/desliga o mesmo flag em
    // paralelo. Minimizar a janela entre desligar o switch e processar o
    // nosso evento específico reduz a chance de outro arquivo religar o
    // switch (no afterEach dele) no meio do caminho.
    for (let i = 0; i < 50; i += 1) {
      if ((await processNextEvent()) === 'no_event') break;
    }

    await setAutonomousExecutionEnabled(false);

    // maxIterations elevado (era 20): sob fila grande compartilhada entre
    // arquivos de teste concorrentes, 20 chamadas a processNextEvent()
    // podem se esgotar antes de alcançar o nosso evento específico
    // (drenando só eventos alheios), deixando `delivery` undefined
    // abaixo — mesmo com o pre-drain acima. O valor por padrão de
    // drainUntil (2000) é seguro aqui pelo mesmo motivo do resto do
    // arquivo; o pre-drain continua reduzindo a janela de corrida com o
    // switch global, este número só evita falso-negativo sob fila cheia.
    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111008 });
    await drainUntil(event.id, 500);

    const [delivery] = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(delivery.status, 'failed');
    assert.equal(delivery.errorCode, 'job_autonomy_disabled');
  });

  test('idempotência: reprocessar o mesmo evento não cria uma segunda delivery nem um segundo Run', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const job = await createJob();
    await createRule(job.id, { filters: {} });

    // Mesmo pre-drain do teste de global autonomy switch acima: esvazia a
    // fila de eventos alheios de outros arquivos concorrentes antes de
    // publicar o nosso, reduzindo a chance de outro arquivo processar
    // (ou de processNextEvent() de outro loop concorrente competir por)
    // linhas nossas entre as duas chamadas de drainUntil abaixo.
    for (let i = 0; i < 50; i += 1) {
      if ((await processNextEvent()) === 'no_event') break;
    }

    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111009 });
    await drainUntil(event.id);

    const deliveriesBefore = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(deliveriesBefore.length, 1);
    const runIdBefore = deliveriesBefore[0].jobRunId;

    // Simula reprocessamento (ex.: recovery após crash) — evento volta a
    // pending e é processado de novo.
    await db.update(agentEvents).set({ status: 'pending' }).where(eq(agentEvents.id, event.id));
    await drainUntil(event.id);

    const deliveriesAfter = await db.select().from(agentEventDeliveries).where(eq(agentEventDeliveries.eventId, event.id));
    assert.equal(deliveriesAfter.length, 1, 'reprocessar não deveria criar uma segunda delivery.');
    assert.equal(deliveriesAfter[0].jobRunId, runIdBefore);

    const runs = await db.select().from(agentJobRuns).where(eq(agentJobRuns.jobId, job.id));
    assert.equal(runs.length, 1, 'reprocessar não deveria criar um segundo Run.');
  });

  test('concorrência: duas chamadas processNextEvent() em paralelo nunca processam o mesmo evento duas vezes (SKIP LOCKED)', async () => {
    const jobA = await createJob();
    const jobB = await createJob();
    await createRule(jobA.id, { filters: { probability: { gte: 999 } } }); // nunca casa, evita LLM
    await createRule(jobB.id, { filters: { probability: { gte: 999 } } });

    const eventOne = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111010 });
    const eventTwo = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111011 });

    // Dispara vários processNextEvent() em paralelo (mais chamadas que
    // eventos de interesse, para tolerar ruído de outros arquivos de
    // teste concorrentes) — SKIP LOCKED garante que nenhuma delas trava
    // ou pega a mesma linha que outra já está processando.
    await Promise.all([processNextEvent(), processNextEvent(), processNextEvent(), processNextEvent()]);

    const reloadedOne = await drainUntil(eventOne.id);
    const reloadedTwo = await drainUntil(eventTwo.id);
    assert.equal(reloadedOne.status, 'ignored');
    assert.equal(reloadedTwo.status, 'ignored');
  });

  test('recovery: evento preso em processing além do timeout volta a pending', async () => {
    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111012 });

    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await db
      .update(agentEvents)
      .set({ status: 'processing', updatedAt: staleTimestamp })
      .where(eq(agentEvents.id, event.id));

    const recovered = await recoverAbandonedEvents();
    assert.ok(recovered >= 1);

    const [reloaded] = await db.select().from(agentEvents).where(eq(agentEvents.id, event.id));
    assert.equal(reloaded.status, 'pending');
    assert.equal(reloaded.attemptCount, 1);
  });

  test('retry: backoff incrementa attempt_count; esgotado o limite vira failed', async () => {
    const event = await publishLeadEvent({ ...LEAD_PAYLOAD, leadId: 111013 });

    await handleProcessingError(event, new Error('falha simulada 1'));
    const [afterFirst] = await db.select().from(agentEvents).where(eq(agentEvents.id, event.id));
    assert.equal(afterFirst.status, 'pending');
    assert.equal(afterFirst.attemptCount, 1);
    assert.ok(afterFirst.nextAttemptAt && afterFirst.nextAttemptAt.getTime() > Date.now());

    // Esgota as tentativas restantes até o limite configurado.
    let current = afterFirst;
    while (current.attemptCount < 5) {
      await handleProcessingError(current, new Error('falha simulada'));
      [current] = await db.select().from(agentEvents).where(eq(agentEvents.id, event.id));
    }

    assert.equal(current.status, 'failed');
  });

  test('security: publishAgentEvent nunca aceita event_type fora do catálogo (mesma proteção testada em publisher.test.ts, reforçada aqui no fluxo do processor)', async () => {
    await assert.rejects(() => publishAgentEvent({ type: 'crm.lead.deleted_by_llm', payload: {} }));
  });
});
