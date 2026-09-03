import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentDirectorDecisions } from '../../db/schema/index.js';
import { computePriority } from '../director/decisions/priority.js';

import type { WorkflowType } from './types.js';

export type DecisionRow = typeof agentDirectorDecisions.$inferSelect;

/**
 * Agentes v2.4 (correio.md seção 13) — "reutilizar a infraestrutura
 * existente de Director Decision Queue... SE semanticamente
 * apropriado" — é: a Decision Queue já é exatamente "coisas que
 * precisam de atenção humana", o mesmo conceito de `manual_attention`.
 * Nenhuma segunda fila de incidentes é criada.
 *
 * Diferenciação de uma decisão estratégica normal (seção 13):
 * `domain='agents'` (já existente desde a v1.8 — "saúde da própria
 * infraestrutura de agentes"), `signalType` sempre prefixado
 * `agents.recovery.*`, e o título/descrição deixam explícito
 * "Problema operacional de recovery", nunca confundido com um sinal de
 * negócio (lead/ticket/projeto/etc). `severity='critical'` +
 * `requiresHumanAttention=true` fixos — uma inconsistência real que o
 * recovery escolheu NÃO adivinhar como consertar é, por definição, algo
 * que merece atenção imediata (mesmo racional de `escalateExecutiveReview`,
 * v2.2).
 *
 * Idempotência: `deduplicationKey` estável por entidade
 * (`agents.recovery.manual_attention::<workflowType>::<entityId>`) +
 * `ON CONFLICT DO NOTHING` — mesmo mecanismo atômico de
 * `decisions/sync-service.ts:upsertSignal`.
 */
export async function escalateToManualAttention(params: {
  workflowType: WorkflowType;
  entityId: number;
  problem: string;
  metadata?: Record<string, unknown>;
  now?: Date;
}): Promise<DecisionRow> {
  const now = params.now ?? new Date();
  const dedupKey = `agents.recovery.manual_attention::${params.workflowType}::${params.entityId}`;

  const factors = computePriority({ severity: 'critical', impact: 'high', urgency: 'immediate', agingDays: 0, occurrenceCount: 1 });

  const inserted = await db
    .insert(agentDirectorDecisions)
    .values({
      deduplicationKey: dedupKey,
      signalType: `agents.recovery.${params.workflowType}_inconsistent`,
      domain: 'agents',
      entityType: params.workflowType,
      entityId: params.entityId,
      title: `Problema operacional de recovery: ${params.workflowType} #${params.entityId}`,
      description: `O reconciliador de workflows (Agentes v2.4) encontrou uma inconsistência que não pode ser resolvida automaticamente com segurança: ${params.problem}`,
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
      metadata: { workflowType: params.workflowType, entityId: params.entityId, problem: params.problem, ...params.metadata },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: agentDirectorDecisions.deduplicationKey })
    .returning();

  if (inserted.length > 0) return inserted[0]!;

  const [existing] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.deduplicationKey, dedupKey)).limit(1);
  if (!existing) throw new Error('Falha ao localizar Decision Item de manual_attention após conflito de criação.');
  return existing;
}
