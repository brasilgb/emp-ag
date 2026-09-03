import { and, eq, lt } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentStrategicMemories } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';

import type { RecoveryAdapter, RecoveryItemResult, StaleCandidate } from './types.js';

/**
 * Agentes v2.4 (correio.md seção 9) — mesmo princípio da Executive
 * Review recovery: `agent_strategic_memories.status='draft'` órfã (claim
 * atômico da v2.3 em `source_review_id`) tem seu slot liberado, nunca
 * "consertada". Nunca fabrica uma memória incompleta como `active`,
 * nunca copia `lesson`/interpretação de outro registro para "consertar"
 * — a única operação possível aqui é DELETE do claim órfão.
 */
export const strategicMemoryRecoveryAdapter: RecoveryAdapter = {
  workflowType: 'strategic_memory',

  async detectStale(thresholdSeconds) {
    const staleBefore = new Date(Date.now() - thresholdSeconds * 1000);
    const rows = await db
      .select()
      .from(agentStrategicMemories)
      .where(and(eq(agentStrategicMemories.status, 'draft'), lt(agentStrategicMemories.updatedAt, staleBefore)));

    return rows.map(
      (row): StaleCandidate => ({
        workflowType: 'strategic_memory',
        entityId: row.id,
        previousState: 'draft',
        ageSeconds: Math.floor((Date.now() - row.updatedAt.getTime()) / 1000),
        problem: `Strategic Memory #${row.id} está "draft" há mais de ${thresholdSeconds}s — claim provavelmente órfão (processo morreu entre o claim e a persistência final).`,
      }),
    );
  },

  async reconcile(candidate, params): Promise<RecoveryItemResult> {
    const staleBefore = new Date(Date.now() - params.thresholdSeconds * 1000);
    const timestamp = new Date().toISOString();

    if (params.dryRun) {
      return {
        workflowType: 'strategic_memory',
        entityId: candidate.entityId,
        previousState: candidate.previousState,
        result: 'reverted',
        reason: 'dry_run: removeria o claim draft órfão, liberando o slot único de source_review_id para uma nova tentativa.',
        timestamp,
      };
    }

    const deleted = await db
      .delete(agentStrategicMemories)
      .where(and(eq(agentStrategicMemories.id, candidate.entityId), eq(agentStrategicMemories.status, 'draft'), lt(agentStrategicMemories.updatedAt, staleBefore)))
      .returning({ id: agentStrategicMemories.id });

    if (deleted.length === 0) {
      return {
        workflowType: 'strategic_memory',
        entityId: candidate.entityId,
        previousState: candidate.previousState,
        result: 'skipped',
        reason: 'Já não estava mais stale no momento da reconciliação (concluída, alterada, ou já reconciliada por outro processo).',
        timestamp,
      };
    }

    await audit({
      userId: params.actorUserId,
      actorType: params.actorUserId ? 'user' : 'system',
      actorId: params.actorUserId ? String(params.actorUserId) : null,
      action: 'agents.recovery.reconciled',
      entityType: 'agent_strategic_memory',
      entityId: String(candidate.entityId),
      metadata: { workflowType: 'strategic_memory', previousState: 'draft', ageSeconds: candidate.ageSeconds, result: 'reverted', reason: 'stale_draft_claim_removed' },
    });

    return {
      workflowType: 'strategic_memory',
      entityId: candidate.entityId,
      previousState: candidate.previousState,
      result: 'reverted',
      reason: 'Claim draft órfão removido — a próxima chamada normal a POST .../memory pode gerar novamente.',
      timestamp,
    };
  },
};
