import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentActionPlanItems, agentActionPlans, agentDirectorGoals, agentExecutiveReviews } from '../../../db/schema/index.js';
import { env } from '../../../config/env.js';
import { audit } from '../../../services/audit.js';
import { AgentError } from '../../errors.js';
import { getLLMProvider } from '../../llm/factory.js';
import { getInitiativeExecutionView } from '../goals/initiatives-execution-service.js';
import { createInitiativeFromExecutiveReview } from '../goals/initiatives-service.js';
import type { InitiativeRow } from '../goals/initiatives-service.js';
import { getRelevantStrategicMemories } from '../memory/retrieval-service.js';

import { buildExecutiveReviewContext } from './context.js';
import { escalateExecutiveReview } from './escalation.js';
import { reviewExecutiveOutcome } from './executive-reviewer.js';
import { REVIEWABLE_EXECUTION_STATES } from './types.js';

export type ExecutiveReviewRow = typeof agentExecutiveReviews.$inferSelect;

export interface GenerateExecutiveReviewResult {
  review: ExecutiveReviewRow;
  created: boolean;
}

const POLL_INTERVAL_MS = 100;
// Generoso o bastante para cobrir env.AGENT_LLM_TIMEOUT_MS (5s por
// padrão) + margem — mesmo racional de CLAIM_POLL_MAX_WAIT_MS em
// initiatives-execution-service.ts.
const POLL_MAX_WAIT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Agentes v2.2 (correio.md seção 11/12) — espera (polling curto, sem
 * lock nenhum) o vencedor da corrida de claim terminar de persistir a
 * review. Se o vencedor reverteu (deletou a linha `draft` porque o LLM
 * falhou — ver `generateExecutiveReview`), quem está esperando não fica
 * preso — recebe um erro claro e pode chamar de novo. Mesmo padrão de
 * `waitForClaimWinner` em `initiatives-execution-service.ts`.
 */
async function waitForReviewCompletion(actionPlanId: number): Promise<ExecutiveReviewRow> {
  const deadline = Date.now() + POLL_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const [row] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.actionPlanId, actionPlanId)).limit(1);

    if (!row) {
      throw new AgentError('conflict', 'A tentativa concorrente de gerar esta Executive Review falhou — tente novamente.');
    }

    if (row.status === 'completed' || row.status === 'superseded') return row;

    await sleep(POLL_INTERVAL_MS);
  }

  throw new AgentError('conflict', 'Tempo esgotado aguardando a geração concorrente desta Executive Review — tente novamente.');
}

/**
 * Agentes v2.2 (correio.md seções 2/5/7/11/12/24) — único ponto de
 * entrada para gerar a Executive Review canônica de uma Initiative já
 * executada. Reutiliza o contexto real (Goal/Initiative/Action
 * Plan/Items via `getInitiativeExecutionView`, a MESMA função da v2.1),
 * o Executive Reviewer (chamada ao LLM oficial) e, quando a recomendação
 * exigir, o pipeline oficial de Initiative/Decision (nunca um mecanismo
 * paralelo).
 *
 * Concorrência (seção 11/12): a UNICIDADE de `action_plan_id` na própria
 * tabela É o mecanismo de claim — `INSERT ... ON CONFLICT DO NOTHING` é
 * atômico por construção (mesmo racional de
 * `decisions/sync-service.ts:upsertSignal`). Quem vence insere a linha
 * `draft` (o claim) e SÓ DEPOIS, fora de qualquer transação, monta o
 * contexto e chama o LLM — nunca held lock durante I/O externo (seção
 * 11: "nunca manter lock ou transaction Postgres aberta enquanto
 * provider LLM... estiver sendo executado", mesma lição da v2.1). Quem
 * perde a corrida lê a linha existente: se já `completed`, devolve
 * direto (idempotente, nenhuma chamada ao LLM); se ainda `draft`, espera
 * o vencedor via `waitForReviewCompletion` (polling curto, sem lock).
 *
 * Falha do provider (seção 24): o `catch` DELETA a linha `draft` — nunca
 * deixa uma review presa para sempre; a próxima chamada (do mesmo
 * caller ou de outro) pode reclamar o slot único e tentar de novo.
 */
export async function generateExecutiveReview(initiative: InitiativeRow, actorUserId: number | null): Promise<GenerateExecutiveReviewResult> {
  if (!initiative.actionPlanId) {
    throw new AgentError('conflict', 'Esta Initiative ainda não tem uma execução (Action Plan) — nada para revisar.');
  }

  const view = await getInitiativeExecutionView(initiative);

  if (!REVIEWABLE_EXECUTION_STATES.includes(view.state as (typeof REVIEWABLE_EXECUTION_STATES)[number])) {
    throw new AgentError(
      'conflict',
      `A execução ainda não chegou a um estado elegível para revisão (estado atual: "${view.state}") — só é possível revisar quando a execução terminar (completed/blocked/failed).`,
    );
  }

  const actionPlanId = initiative.actionPlanId;
  const now = new Date();

  // --- claim atômico (INSERT ... ON CONFLICT DO NOTHING, sem transação) ---
  const claimed = await db
    .insert(agentExecutiveReviews)
    .values({
      goalId: initiative.goalId,
      initiativeId: initiative.id,
      actionPlanId,
      createdBy: actorUserId,
      reviewType: 'initiative_outcome',
      status: 'draft',
      evidence: {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: agentExecutiveReviews.actionPlanId })
    .returning();

  if (claimed.length === 0) {
    const [existing] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.actionPlanId, actionPlanId)).limit(1);
    if (!existing) throw new AgentError('conflict', 'Falha ao localizar Executive Review após conflito de criação — tente novamente.');

    if (existing.status === 'completed' || existing.status === 'superseded') {
      return { review: existing, created: false };
    }

    const resolved = await waitForReviewCompletion(actionPlanId);
    return { review: resolved, created: false };
  }

  const draft = claimed[0]!;

  await audit({
    userId: actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    actorId: actorUserId ? String(actorUserId) : null,
    action: 'agents.director.review.requested',
    entityType: 'agent_executive_review',
    entityId: String(draft.id),
    metadata: { initiativeId: initiative.id, goalId: initiative.goalId, actionPlanId },
  });

  // --- fora de transação: monta contexto + chama o LLM ---
  try {
    const [goal] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, initiative.goalId)).limit(1);
    if (!goal) throw new AgentError('validation_error', 'Goal vinculado à Initiative não foi encontrado.');

    const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, actionPlanId)).limit(1);
    if (!plan) throw new AgentError('validation_error', 'Action Plan vinculado à Initiative não foi encontrado.');

    const items = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, actionPlanId)).orderBy(agentActionPlanItems.sequence);

    const { context, expectedResult, actualResult } = buildExecutiveReviewContext({ goal, initiative, plan, items, view });

    if (!env.AGENT_LLM_ENABLED) {
      throw new AgentError('llm_unavailable', 'Geração de Executive Review requer o LLM habilitado (AGENT_LLM_ENABLED=false).');
    }

    // Agentes v2.3 (correio.md seção 11/12/20) — recupera memórias
    // estratégicas relevantes do MESMO domínio do Goal (determinístico,
    // sem embeddings — seção 9/10) e as injeta no prompt do Executive
    // Reviewer, sempre numa seção separada de "CURRENT EVIDENCE" (nunca
    // misturadas). IDs efetivamente usados ficam auditáveis (seção 20).
    const historicalMemories = await getRelevantStrategicMemories({ domain: goal.domain });

    const reviewed = await reviewExecutiveOutcome({
      provider: getLLMProvider(),
      model: env.AGENT_LLM_MODEL,
      context,
      timeoutMs: env.AGENT_LLM_TIMEOUT_MS,
      historicalMemories,
    });

    if (reviewed.status !== 'ok' || !reviewed.output) {
      throw new AgentError('review_failed', reviewed.errorMessage ?? 'Não foi possível gerar a Executive Review a partir da evidência disponível.');
    }

    const output = reviewed.output;

    // --- persistência curta: completa a review ---
    const [completedReview] = await db
      .update(agentExecutiveReviews)
      .set({
        status: 'completed',
        outcome: output.outcome,
        summary: output.summary,
        expectedResult,
        actualResult,
        evidence: context as unknown as Record<string, unknown>,
        assessment: output.assessment,
        confidence: output.confidence.toFixed(3),
        recommendationType: output.recommendation.type,
        recommendation: output.recommendation,
        updatedAt: new Date(),
      })
      .where(eq(agentExecutiveReviews.id, draft.id))
      .returning();

    await audit({
      userId: actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      actorId: actorUserId ? String(actorUserId) : null,
      action: 'agents.director.review.completed',
      entityType: 'agent_executive_review',
      entityId: String(draft.id),
      metadata: { initiativeId: initiative.id, goalId: initiative.goalId, outcome: output.outcome, recommendationType: output.recommendation.type },
    });

    // Agentes v2.3 (correio.md seção 16/20) — auditoria de USO de
    // memória: registra exatamente quais memoryIds entraram no contexto
    // desta review, respondendo "por que o Diretor considerou essa
    // experiência anterior?". Só audita quando há alguma memória de
    // verdade (nunca um evento vazio/ruído).
    if (historicalMemories.length > 0) {
      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.director.memory.reused',
        entityType: 'agent_executive_review',
        entityId: String(draft.id),
        metadata: { memoryIdsUsed: historicalMemories.map((memory) => memory.id), domain: goal.domain, reason: 'used_as_context_for_review' },
      });
    }

    // --- efeitos colaterais autorizados (nunca execução) ---
    let resultingInitiativeId: number | null = null;
    let resultingDecisionId: number | null = null;

    if (output.recommendation.type === 'new_initiative') {
      const createdInitiative = await createInitiativeFromExecutiveReview({
        goal,
        reviewId: draft.id,
        proposedGoal: output.recommendation.proposedGoal,
        reason: output.recommendation.reason,
        sourceInitiativeTitle: initiative.title,
      });
      resultingInitiativeId = createdInitiative.id;

      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.director.review.initiative_proposed',
        entityType: 'agent_executive_review',
        entityId: String(draft.id),
        metadata: { resultingInitiativeId: createdInitiative.id, goalId: goal.id },
      });
    } else if (output.recommendation.type === 'escalate') {
      const decision = await escalateExecutiveReview({
        reviewId: draft.id,
        goalId: goal.id,
        goalTitle: goal.title,
        goalDomain: goal.domain,
        initiativeId: initiative.id,
        initiativeTitle: initiative.title,
        recommendation: output.recommendation,
      });
      resultingDecisionId = decision.id;

      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.director.review.recommendation_escalated',
        entityType: 'agent_executive_review',
        entityId: String(draft.id),
        metadata: { resultingDecisionId: decision.id, goalId: goal.id },
      });
    }

    if (resultingInitiativeId !== null || resultingDecisionId !== null) {
      const [linked] = await db
        .update(agentExecutiveReviews)
        .set({ resultingInitiativeId, resultingDecisionId, updatedAt: new Date() })
        .where(eq(agentExecutiveReviews.id, draft.id))
        .returning();
      return { review: linked!, created: true };
    }

    return { review: completedReview!, created: true };
  } catch (error) {
    // Reverte o claim (seção 24: "não deixar review permanentemente
    // presa; permitir retry seguro") — deleta a linha draft, liberando o
    // slot único de action_plan_id para uma nova tentativa.
    await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, draft.id));
    throw error;
  }
}

/**
 * Agentes v2.2 (correio.md seção 15) — leitura da review canônica de uma
 * Initiative. Nunca retorna uma linha `draft` (review em geração
 * concorrente não é "a" review ainda — evita expor estado transitório
 * incompleto ao frontend).
 */
export async function getExecutiveReviewForInitiative(initiative: InitiativeRow): Promise<ExecutiveReviewRow | null> {
  if (!initiative.actionPlanId) return null;

  const [row] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.actionPlanId, initiative.actionPlanId)).limit(1);
  if (!row || row.status === 'draft') return null;
  return row;
}
