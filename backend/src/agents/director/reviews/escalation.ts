import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorDecisions } from '../../../db/schema/index.js';
import { computePriority } from '../decisions/priority.js';
import type { SignalDomain } from '../types.js';

import type { ExecutiveReviewOutput } from './schemas.js';

export type DecisionRow = typeof agentDirectorDecisions.$inferSelect;

/**
 * Agentes v2.2 (correio.md seção 22) — "se houver sistema de decisões já
 * existente no Diretor, reutilizá-lo em vez de criar uma segunda entidade
 * equivalente": recomendação `escalate` de uma Executive Review vira um
 * Decision Item REAL na mesma Director Decision Queue da v1.9
 * (`agent_director_decisions`), nunca uma tabela/fila paralela de
 * "escalations". `requiresHumanAttention=true` já é o mecanismo existente
 * que faz este item aparecer destacado no brief do Diretor.
 *
 * Severidade/impacto/urgência fixos em `critical`/`high`/`immediate`
 * (decisão deliberada, documentada aqui): uma escalação vinda de uma
 * Executive Review É por definição algo que o Diretor concluiu exigir
 * decisão explícita do CEO — não há um sinal operacional bruto do qual
 * derivar esses três eixos como nos sinais coletados por
 * `operational-signals.ts`, então usar o teto de cada eixo é o
 * comportamento mais seguro (nunca sub-prioriza uma escalação).
 *
 * Idempotência: `deduplicationKey` estável por review
 * (`director.executive_review_escalation::agent_executive_review::<reviewId>`)
 * + `ON CONFLICT DO NOTHING` — mesmo mecanismo atômico de
 * `decisions/sync-service.ts:upsertSignal`, nunca find-then-insert. Uma
 * Executive Review só é gerada uma vez (unique em `action_plan_id`), então
 * esta função só roda uma vez por review em circunstâncias normais; o
 * guard aqui é defesa em profundidade, não o mecanismo primário.
 */
export async function escalateExecutiveReview(params: {
  reviewId: number;
  goalId: number;
  goalTitle: string;
  goalDomain: string;
  initiativeId: number;
  initiativeTitle: string;
  recommendation: ExecutiveReviewOutput['recommendation'];
  now?: Date;
}): Promise<DecisionRow> {
  const now = params.now ?? new Date();
  const dedupKey = `director.executive_review_escalation::agent_executive_review::${params.reviewId}`;

  const factors = computePriority({ severity: 'critical', impact: 'high', urgency: 'immediate', agingDays: 0, occurrenceCount: 1 });

  const inserted = await db
    .insert(agentDirectorDecisions)
    .values({
      deduplicationKey: dedupKey,
      signalType: 'director.executive_review_escalation',
      domain: params.goalDomain as SignalDomain,
      entityType: 'agent_executive_review',
      entityId: params.reviewId,
      title: `Decisão do CEO necessária: ${params.initiativeTitle}`,
      description: `Executive Review da Initiative "${params.initiativeTitle}" (Goal "${params.goalTitle}") recomendou escalação: ${params.recommendation.reason}`,
      severity: 'critical',
      impact: 'high',
      urgency: 'immediate',
      priorityScore: factors.total,
      priorityFactors: factors,
      status: 'open',
      requiresHumanAttention: true,
      firstDetectedAt: now,
      lastDetectedAt: now,
      occurrenceCount: 1,
      metadata: { reviewId: params.reviewId, goalId: params.goalId, initiativeId: params.initiativeId, reason: params.recommendation.reason },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: agentDirectorDecisions.deduplicationKey })
    .returning();

  if (inserted.length > 0) return inserted[0]!;

  const [existing] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.deduplicationKey, dedupKey)).limit(1);
  if (!existing) throw new Error('Falha ao localizar Decision Item de escalação após conflito de criação.');
  return existing;
}
