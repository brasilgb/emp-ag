import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentEvents } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import type { Tx } from '../../routes/agents/helpers.js';
import { getLineageContext } from '../autonomy/lineage-context.js';
import { getEventDefinition } from './catalog.js';

export interface PublishAgentEventParams {
  type: string;
  aggregateType?: string | null;
  aggregateId?: string | number | null;
  payload: unknown;
  source?: string | null;
  idempotencyKey?: string | null;
  occurredAt?: Date;
}

/**
 * Agentes v1.4 (correio.md seções 8/9) — único ponto de publicação de
 * eventos internos. O domínio NUNCA conhece Job Runner, Planner, LLM ou
 * Executor — só chama esta função depois de concluir sua própria operação
 * de negócio.
 *
 * `executor` aceita `db` (default) ou uma `tx` de uma transação já aberta
 * pelo chamador — quando o handler de origem já é transacional (a maioria
 * dos pontos reais instrumentados nesta versão: stage change de lead,
 * criação/atualização de tarefa, pagamento, ticket), o evento entra na
 * MESMA transação da mudança de negócio (garantia atômica real, seção 9).
 * Handlers não-transacionais (client/lead/project/entry create) publicam
 * logo após o commit do insert — pequena janela não-atômica aceita e
 * documentada, em vez de forçar uma transação só para isso.
 */
export async function publishAgentEvent(
  params: PublishAgentEventParams,
  executor: typeof db | Tx = db,
): Promise<typeof agentEvents.$inferSelect> {
  const definition = getEventDefinition(params.type);

  if (!definition) {
    // Erro de programação (tipo de evento inventado por código novo, não
    // por entrada de usuário/LLM) — nunca deveria acontecer em produção;
    // lança alto para pegar em desenvolvimento/CI, nunca silenciosamente
    // vira um evento "solto" fora do catálogo.
    throw new Error(`publishAgentEvent: tipo de evento desconhecido no catálogo: "${params.type}".`);
  }

  const parsedPayload = definition.payloadSchema.safeParse(params.payload);

  if (!parsedPayload.success) {
    throw new Error(
      `publishAgentEvent: payload inválido para "${params.type}": ${parsedPayload.error.issues[0]?.message ?? 'erro de validação'}.`,
    );
  }

  // Agentes v1.5 — Lineage propagation (correio.md seções 13/14): quando
  // publishAgentEvent é alcançado de dentro de um Run (tool → domínio →
  // aqui), agents/autonomy/lineage-context.ts carrega o contexto via
  // AsyncLocalStorage. Fora de um Run (rota HTTP comum criando um lead,
  // por exemplo), o contexto está ausente e as 3 colunas ficam null — nunca
  // lineage falsa atribuída a uma ação de usuário.
  const lineage = getLineageContext();

  try {
    const [event] = await executor
      .insert(agentEvents)
      .values({
        eventType: definition.type,
        eventVersion: definition.version,
        source: params.source ?? null,
        aggregateType: params.aggregateType ?? null,
        aggregateId: params.aggregateId !== undefined && params.aggregateId !== null ? String(params.aggregateId) : null,
        payload: parsedPayload.data,
        idempotencyKey: params.idempotencyKey ?? null,
        status: 'pending',
        occurredAt: params.occurredAt ?? new Date(),
        causedByRunId: lineage?.causationRunId ?? null,
        rootExecutionId: lineage?.rootExecutionId ?? null,
        autonomyDepth: lineage?.autonomyDepth ?? null,
      })
      .returning();

    await audit({
      userId: null,
      actorType: 'system',
      actorId: params.source ?? 'domain',
      action: 'agent_event.received',
      entityType: 'agent_event',
      entityId: String(event.id),
      metadata: { eventType: event.eventType, aggregateType: event.aggregateType, aggregateId: event.aggregateId },
    });

    return event;
  } catch (error) {
    // Idempotência (seção 4/12): retry do publisher com a mesma
    // idempotencyKey colide no índice único parcial e devolve o evento já
    // publicado, nunca duplica — mesmo padrão de agent_executions
    // (execution/pipeline.ts). Só funciona de verdade quando `executor` é
    // `db`: dentro de uma `tx` já aberta pelo chamador, um erro do insert
    // aborta a transação inteira no Postgres e este SELECT de fallback
    // também falharia — publicar com idempotencyKey dentro de uma tx do
    // domínio não é o caso de uso esperado (pontos instrumentados nesta
    // versão nunca passam idempotencyKey).
    if (params.idempotencyKey) {
      const [existing] = await executor
        .select()
        .from(agentEvents)
        .where(eq(agentEvents.idempotencyKey, params.idempotencyKey))
        .limit(1);

      if (existing) {
        return existing;
      }
    }

    throw error;
  }
}
