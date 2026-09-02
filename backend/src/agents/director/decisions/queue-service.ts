import { and, asc, count, desc, eq, gte, inArray, SQL } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentActionPlanItems, agentApprovals, agentDirectorDecisions } from '../../../db/schema/index.js';
import type { SignalDomain, SignalSeverity } from '../types.js';

import { OPEN_DECISION_STATUSES, type DecisionStatus } from './types.js';

export type DecisionRow = typeof agentDirectorDecisions.$inferSelect;

/**
 * Agentes v1.9 (correio.md secao 14) - approval real derivado sob
 * demanda via a cadeia ja existente (action_plan -> plan_items ->
 * approvals), nunca uma coluna approval_id duplicada. "Evitar
 * duplicacao de estado sempre que possivel."
 */
export async function getPendingApprovalForPlan(actionPlanId: number | null) {
  if (!actionPlanId) return null;

  const items = await db
    .select({ id: agentActionPlanItems.id })
    .from(agentActionPlanItems)
    .where(eq(agentActionPlanItems.planId, actionPlanId));

  if (items.length === 0) return null;

  const [pending] = await db
    .select()
    .from(agentApprovals)
    .where(and(inArray(agentApprovals.planItemId, items.map((item) => item.id)), eq(agentApprovals.status, 'pending')))
    .orderBy(desc(agentApprovals.createdAt))
    .limit(1);

  return pending ?? null;
}

export interface ListDecisionsParams {
  page: number;
  limit: number;
  status?: DecisionStatus;
  domain?: SignalDomain;
  severity?: SignalSeverity;
  assignedUserId?: number;
  requiresHumanAttention?: boolean;
}

// Ordenação principal (correio.md seção 12): priorityScore DESC,
// desempate por firstDetectedAt ASC (o item aberto há mais tempo, entre
// dois de mesma prioridade, vem primeiro) — determinístico, documentado.
export async function listDecisions(params: ListDecisionsParams) {
  const conditions: SQL[] = [];
  if (params.status) conditions.push(eq(agentDirectorDecisions.status, params.status));
  if (params.domain) conditions.push(eq(agentDirectorDecisions.domain, params.domain));
  if (params.severity) conditions.push(eq(agentDirectorDecisions.severity, params.severity));
  if (params.assignedUserId) conditions.push(eq(agentDirectorDecisions.assignedUserId, params.assignedUserId));
  if (params.requiresHumanAttention !== undefined)
    conditions.push(eq(agentDirectorDecisions.requiresHumanAttention, params.requiresHumanAttention));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentDirectorDecisions)
      .where(where)
      .orderBy(desc(agentDirectorDecisions.priorityScore), asc(agentDirectorDecisions.firstDetectedAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentDirectorDecisions).where(where),
  ]);

  return { rows, total: Number(total) };
}

export async function getDecisionById(id: number): Promise<DecisionRow | null> {
  const [row] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, id)).limit(1);
  return row ?? null;
}

/**
 * Agentes v1.9 (correio.md seção 12) — vistas derivadas para a UX
 * executiva (seção 26): topo crítico, aguardando decisão humana,
 * aguardando approval, envelhecendo, recorrentes. Todas reaproveitam a
 * mesma tabela/índices, nenhuma coleção paralela.
 */
export async function getQueueOverview(now: Date = new Date()) {
  const [topCritical, awaitingHuman, awaitingApproval, aging, recurrent, openCount] = await Promise.all([
    db
      .select()
      .from(agentDirectorDecisions)
      .where(and(eq(agentDirectorDecisions.severity, 'critical'), inArray(agentDirectorDecisions.status, OPEN_DECISION_STATUSES as string[])))
      .orderBy(desc(agentDirectorDecisions.priorityScore))
      .limit(10),
    db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.requiresHumanAttention, true))
      .orderBy(desc(agentDirectorDecisions.priorityScore))
      .limit(20),
    db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.status, 'awaiting_approval'))
      .orderBy(desc(agentDirectorDecisions.priorityScore)),
    db
      .select()
      .from(agentDirectorDecisions)
      .where(
        and(
          inArray(agentDirectorDecisions.status, OPEN_DECISION_STATUSES as string[]),
          gte(agentDirectorDecisions.priorityScore, 0),
        ),
      )
      .orderBy(asc(agentDirectorDecisions.firstDetectedAt))
      .limit(10),
    db
      .select()
      .from(agentDirectorDecisions)
      .where(
        and(inArray(agentDirectorDecisions.status, OPEN_DECISION_STATUSES as string[]), gte(agentDirectorDecisions.occurrenceCount, 2)),
      )
      .orderBy(desc(agentDirectorDecisions.occurrenceCount))
      .limit(10),
    db
      .select({ total: count() })
      .from(agentDirectorDecisions)
      .where(inArray(agentDirectorDecisions.status, OPEN_DECISION_STATUSES as string[])),
  ]);

  return {
    generatedAt: now.toISOString(),
    topCritical,
    awaitingHumanAttention: awaitingHuman,
    awaitingApproval,
    agingOldestFirst: aging,
    mostRecurrent: recurrent,
    openTotal: Number(openCount[0]?.total ?? 0),
  };
}
