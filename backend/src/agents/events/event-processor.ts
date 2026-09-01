import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentEventDeliveries, agentEventRules, agentEvents } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { audit } from '../../services/audit.js';
import { runAgentJob } from '../jobs/job-runner.js';
import { getEventDefinition } from './catalog.js';
import { evaluateFilters } from './filters.js';
import type { EventFilters } from './filters.js';

type AgentEventRow = typeof agentEvents.$inferSelect;

/**
 * Agentes v1.4 (correio.md seção 10) — Event Processor determinístico.
 * Único ponto que decide "esta regra casa com este evento" e dispara o
 * Job correspondente — SEMPRE via `runAgentJob()` (a mesma função da
 * v1.3, sem cópia). NUNCA importa `planner`, `tool-registry`, o provider
 * de LLM ou `action-plan-executor` diretamente — essa é a garantia
 * arquitetural central da v1.4 (seção 1: "essas responsabilidades não
 * podem ser misturadas").
 */
export async function processNextEvent(): Promise<'processed' | 'no_event'> {
  const claimed = await claimNextPendingEvent();

  if (!claimed) {
    return 'no_event';
  }

  await audit({
    userId: null,
    actorType: 'system',
    actorId: null,
    action: 'agent_event.processing_started',
    entityType: 'agent_event',
    entityId: String(claimed.id),
    metadata: { eventType: claimed.eventType, attemptCount: claimed.attemptCount },
  });

  try {
    await dispatchEvent(claimed);
  } catch (error) {
    await handleProcessingError(claimed, error);
  }

  return 'processed';
}

// SELECT ... FOR UPDATE SKIP LOCKED (correio.md seção 13) — protege só a
// seleção/transição para 'processing', nunca segura a transação durante
// o matching/dispatch (que chama runAgentJob, potencialmente lento —
// LLM/tools). Dois processors concorrentes nunca pegam o mesmo evento:
// SKIP LOCKED faz o segundo pular a linha já travada pelo primeiro em vez
// de esperar ou colidir.
async function claimNextPendingEvent(): Promise<AgentEventRow | null> {
  return db.transaction(async (tx) => {
    const now = new Date();

    const [event] = await tx
      .select()
      .from(agentEvents)
      .where(and(eq(agentEvents.status, 'pending'), or(isNull(agentEvents.nextAttemptAt), lte(agentEvents.nextAttemptAt, now))))
      .orderBy(asc(agentEvents.receivedAt))
      .limit(1)
      .for('update', { skipLocked: true });

    if (!event) {
      return null;
    }

    const [updated] = await tx
      .update(agentEvents)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(agentEvents.id, event.id))
      .returning();

    return updated;
  });
}

async function dispatchEvent(event: AgentEventRow): Promise<void> {
  // Defesa em profundidade (seção 10, item 3): publisher já validou tipo
  // e versão contra o catálogo no momento da publicação, mas o processor
  // nunca confia cegamente de novo — o catálogo pode ter mudado entre a
  // publicação e o processamento (deploy no meio do caminho).
  const definition = getEventDefinition(event.eventType);

  if (!definition || definition.version !== event.eventVersion) {
    await finishEvent(event.id, 'failed');

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agent_event.failed',
      entityType: 'agent_event',
      entityId: String(event.id),
      metadata: { reason: 'unknown_event_type_or_version', eventType: event.eventType, eventVersion: event.eventVersion },
    });

    return;
  }

  const rules = await db
    .select()
    .from(agentEventRules)
    .where(
      and(
        eq(agentEventRules.eventType, event.eventType),
        eq(agentEventRules.eventVersion, event.eventVersion),
        eq(agentEventRules.enabled, true),
      ),
    );

  const matchingRules = rules.filter((rule) => evaluateFilters(rule.filters as EventFilters, event.payload as Record<string, unknown>));

  if (matchingRules.length === 0) {
    await finishEvent(event.id, 'ignored');

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agent_event.ignored',
      entityType: 'agent_event',
      entityId: String(event.id),
      metadata: { eventType: event.eventType, candidateRules: rules.length },
    });

    return;
  }

  await audit({
    userId: null,
    actorType: 'system',
    actorId: null,
    action: 'agent_event.matched',
    entityType: 'agent_event',
    entityId: String(event.id),
    metadata: { eventType: event.eventType, ruleIds: matchingRules.map((rule) => rule.id) },
  });

  for (const rule of matchingRules) {
    await deliverToRule(event, rule);
  }

  await finishEvent(event.id, 'processed');

  await audit({
    userId: null,
    actorType: 'system',
    actorId: null,
    action: 'agent_event.processed',
    entityType: 'agent_event',
    entityId: String(event.id),
    metadata: { eventType: event.eventType, deliveredRules: matchingRules.length },
  });
}

async function deliverToRule(event: AgentEventRow, rule: typeof agentEventRules.$inferSelect): Promise<void> {
  // Idempotência real a nível de banco (seção 12): índice único
  // (event_id, rule_id) — um reprocessamento deste mesmo evento nunca
  // cria uma segunda delivery nem um segundo Run para a mesma regra.
  const [delivery] = await db
    .insert(agentEventDeliveries)
    .values({ eventId: event.id, ruleId: rule.id, jobId: rule.jobId, status: 'matched' })
    .onConflictDoNothing({ target: [agentEventDeliveries.eventId, agentEventDeliveries.ruleId] })
    .returning();

  if (!delivery) {
    // Já existia — este par (event, rule) já foi entregue antes.
    return;
  }

  // Chave derivada de event_id+rule_id (seção 12) — segunda camada de
  // proteção, agora a nível do próprio Job Run (agent_job_runs já garante
  // unique(job_id, idempotency_key) desde a v1.3).
  const idempotencyKey = `event:${event.id}:rule:${rule.id}`;

  // deliveryId (Agentes v1.5, correio.md seção 4): permite ao Run gravar
  // causation_event_delivery_id — a delivery concreta (regra × evento) que
  // o disparou, sem precisar de um segundo lookup dentro de job-runner.ts.
  const result = await runAgentJob(
    rule.jobId,
    { type: 'internal_event', payload: { eventId: event.id, ruleId: rule.id, deliveryId: delivery.id } },
    null,
    idempotencyKey,
  );

  if (result.ok) {
    await db
      .update(agentEventDeliveries)
      .set({ status: 'triggered', jobRunId: result.run.id, processedAt: new Date() })
      .where(eq(agentEventDeliveries.id, delivery.id));

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agent_job.triggered_by_event',
      entityType: 'agent_job_run',
      entityId: String(result.run.id),
      metadata: { eventId: event.id, ruleId: rule.id, jobId: rule.jobId, runId: result.run.id },
    });

    return;
  }

  await db
    .update(agentEventDeliveries)
    .set({ status: 'failed', errorCode: result.code, errorMessage: result.message, processedAt: new Date() })
    .where(eq(agentEventDeliveries.id, delivery.id));
}

async function finishEvent(eventId: number, status: 'processed' | 'ignored' | 'failed'): Promise<void> {
  await db
    .update(agentEvents)
    .set({ status, processedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentEvents.id, eventId));
}

// Retry com backoff exponencial determinístico (correio.md seção 14) —
// nunca loop infinito: esgotado AGENT_EVENTS_MAX_ATTEMPTS, o evento vira
// 'failed' definitivamente (só volta via POST /agents/events/:id/retry,
// uma ação administrativa explícita).
// Exportada só para o teste de backoff/limite de tentativas exercitar
// diretamente (event-processor.test.ts) — o caminho normal (chamada via
// processNextEvent) não é fácil de forçar a lançar sem fault injection.
export async function handleProcessingError(event: AgentEventRow, error: unknown): Promise<void> {
  const attemptCount = event.attemptCount + 1;
  const message = error instanceof Error ? error.message : String(error);

  if (attemptCount >= env.AGENT_EVENTS_MAX_ATTEMPTS) {
    await db
      .update(agentEvents)
      .set({ status: 'failed', attemptCount, lastError: message, processedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentEvents.id, event.id));

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agent_event.failed',
      entityType: 'agent_event',
      entityId: String(event.id),
      metadata: { attemptCount, lastError: message },
    });

    return;
  }

  const backoffSeconds = env.AGENT_EVENTS_RETRY_BASE_SECONDS * 2 ** (attemptCount - 1);

  await db
    .update(agentEvents)
    .set({
      status: 'pending',
      attemptCount,
      lastError: message,
      nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000),
      updatedAt: new Date(),
    })
    .where(eq(agentEvents.id, event.id));
}

/**
 * Recovery após restart (correio.md seção 15) — mesmo princípio de
 * `agents/jobs/job-runner.ts:recoverAbandonedRuns()`: eventos presos em
 * `processing` há mais que `AGENT_EVENTS_PROCESSING_TIMEOUT_SECONDS`
 * voltam a `pending` (se ainda houver tentativas) ou `failed` (se
 * esgotadas) — nunca ficam presos para sempre por causa de um crash no
 * meio do processamento.
 */
export async function recoverAbandonedEvents(): Promise<number> {
  const staleThreshold = new Date(Date.now() - env.AGENT_EVENTS_PROCESSING_TIMEOUT_SECONDS * 1000);

  const staleEvents = await db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.status, 'processing'), lt(agentEvents.updatedAt, staleThreshold)));

  let recovered = 0;

  for (const event of staleEvents) {
    const attemptCount = event.attemptCount + 1;
    const lastError = 'Processamento abandonado detectado na inicialização do processo (provável reinício/crash).';

    if (attemptCount >= env.AGENT_EVENTS_MAX_ATTEMPTS) {
      await db
        .update(agentEvents)
        .set({ status: 'failed', attemptCount, lastError, processedAt: new Date(), updatedAt: new Date() })
        .where(eq(agentEvents.id, event.id));
    } else {
      await db
        .update(agentEvents)
        .set({ status: 'pending', attemptCount, lastError, nextAttemptAt: new Date(), updatedAt: new Date() })
        .where(eq(agentEvents.id, event.id));
    }

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agent_event.failed',
      entityType: 'agent_event',
      entityId: String(event.id),
      metadata: { reason: 'processing_abandoned', attemptCount },
    });

    recovered += 1;
  }

  return recovered;
}
