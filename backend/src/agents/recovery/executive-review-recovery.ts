import { and, eq, lt } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentExecutiveReviews } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';

import type { RecoveryAdapter, RecoveryItemResult, StaleCandidate } from './types.js';

/**
 * Agentes v2.4 (correio.md seção 8) — recovery para
 * `agent_executive_reviews.status='draft'` órfã: o claim atômico da v2.2
 * (`INSERT ... ON CONFLICT DO NOTHING` em `action_plan_id`) sobrevive a
 * um crash do processo entre o claim e a chamada ao LLM/persistência
 * final — a linha `draft` fica presa para sempre, bloqueando o slot
 * único (nenhuma nova tentativa de gerar review para aquele Action Plan
 * consegue reclamar o `action_plan_id`).
 *
 * "Não chamar LLM automaticamente durante reconciliação" (seção 8) —
 * este adapter NUNCA importa `llm/factory.ts` nem
 * `reviews/executive-reviewer.ts`. Só libera o slot; a próxima chamada
 * NORMAL a `POST .../review` (pipeline oficial, v2.2) reclama o claim e
 * gera a review de verdade.
 */
export const executiveReviewRecoveryAdapter: RecoveryAdapter = {
  workflowType: 'executive_review',

  async detectStale(thresholdSeconds) {
    const staleBefore = new Date(Date.now() - thresholdSeconds * 1000);
    const rows = await db
      .select()
      .from(agentExecutiveReviews)
      .where(and(eq(agentExecutiveReviews.status, 'draft'), lt(agentExecutiveReviews.updatedAt, staleBefore)));

    return rows.map(
      (row): StaleCandidate => ({
        workflowType: 'executive_review',
        entityId: row.id,
        previousState: 'draft',
        ageSeconds: Math.floor((Date.now() - row.updatedAt.getTime()) / 1000),
        problem: `Executive Review #${row.id} está "draft" há mais de ${thresholdSeconds}s — claim provavelmente órfão (processo morreu entre o claim e a persistência final).`,
      }),
    );
  },

  async reconcile(candidate, params): Promise<RecoveryItemResult> {
    const staleBefore = new Date(Date.now() - params.thresholdSeconds * 1000);
    const timestamp = new Date().toISOString();

    if (params.dryRun) {
      return {
        workflowType: 'executive_review',
        entityId: candidate.entityId,
        previousState: candidate.previousState,
        result: 'reverted',
        reason: 'dry_run: removeria o claim draft órfão, liberando o slot único de action_plan_id para uma nova tentativa.',
        timestamp,
      };
    }

    // Predicado forte (seção 23): id + status='draft' + updated_at <
    // staleBefore — nunca um DELETE cego. `RETURNING` prova atomicamente
    // se ESTA chamada foi quem removeu (nunca duas simultâneas).
    const deleted = await db
      .delete(agentExecutiveReviews)
      .where(and(eq(agentExecutiveReviews.id, candidate.entityId), eq(agentExecutiveReviews.status, 'draft'), lt(agentExecutiveReviews.updatedAt, staleBefore)))
      .returning({ id: agentExecutiveReviews.id });

    if (deleted.length === 0) {
      return {
        workflowType: 'executive_review',
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
      entityType: 'agent_executive_review',
      entityId: String(candidate.entityId),
      metadata: { workflowType: 'executive_review', previousState: 'draft', ageSeconds: candidate.ageSeconds, result: 'reverted', reason: 'stale_draft_claim_removed' },
    });

    return {
      workflowType: 'executive_review',
      entityId: candidate.entityId,
      previousState: candidate.previousState,
      result: 'reverted',
      reason: 'Claim draft órfão removido — a próxima chamada normal a POST .../review pode gerar novamente.',
      timestamp,
    };
  },
};
