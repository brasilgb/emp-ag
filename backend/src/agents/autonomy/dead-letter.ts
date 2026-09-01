import { db } from '../../db/index.js';
import { agentAutonomyBlocks } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import type { RunTrigger } from '../jobs/job-runner.js';
import type { ResolvedCausation } from './guard.js';
import type { AutonomyBlockReason } from './reasons.js';

/**
 * Dead Letter / Blocked autonomous operations (correio.md seção 15) —
 * chamada só por agents/jobs/job-runner.ts logo após a transação de
 * `evaluateAutonomousExecution` retornar `allowed:false` (fora da
 * transação já encerrada: nenhum Run foi criado, mas o bloqueio em si
 * precisa ficar registrado independentemente do rollback). Nunca apaga
 * nada — cada chamada é uma linha nova.
 *
 * Não escreve em agent_event_deliveries: quando o trigger é
 * `internal_event`, agents/events/event-processor.ts (deliverToRule) já
 * marca a delivery como `failed`/`errorCode` genericamente a partir do
 * `code`/`message` que runAgentJob devolve para QUALQUER falha (inclusive
 * um bloqueio de autonomia, já que o guard devolve o `reason` como
 * AgentErrorCode) — escrever aqui de novo duplicaria a mesma
 * responsabilidade em dois lugares.
 */
export async function recordAutonomyBlock(params: {
  jobId: number;
  trigger: RunTrigger;
  reason: AutonomyBlockReason;
  causation: ResolvedCausation;
  limit?: number;
  current?: number;
}): Promise<void> {
  const { jobId, trigger, reason, causation, limit, current } = params;

  const payload = trigger.payload as { eventId?: number; ruleId?: number } | undefined;
  const eventId = trigger.type === 'internal_event' ? (payload?.eventId ?? null) : null;
  const ruleId = trigger.type === 'internal_event' ? (payload?.ruleId ?? null) : null;

  const [block] = await db
    .insert(agentAutonomyBlocks)
    .values({
      jobId,
      ruleId,
      eventId,
      triggerType: trigger.type,
      reason,
      rootExecutionId: causation.rootExecutionId,
      causationRunId: causation.causationRunId,
      attemptedDepth: causation.autonomyDepth,
      limitValue: limit ?? null,
      currentValue: current ?? null,
    })
    .returning();

  await audit({
    userId: null,
    actorType: 'system',
    actorId: null,
    action: 'agent_autonomy.blocked',
    entityType: 'agent_autonomy_block',
    entityId: String(block.id),
    metadata: { jobId, reason, triggerType: trigger.type, rootExecutionId: causation.rootExecutionId, attemptedDepth: causation.autonomyDepth, limit, current },
  });
}
