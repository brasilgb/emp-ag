import { and, asc, count, eq, SQL } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoalEvaluations, agentDirectorGoalMetrics, agentDirectorGoals, users } from '../../../db/schema/index.js';
import { AgentError } from '../../errors.js';
import { audit } from '../../../services/audit.js';
import type { SignalDomain } from '../types.js';

import { getMetricCatalogEntry } from './metrics/catalog.js';
import type { GoalHealth, GoalStatus, GoalTargetType } from './types.js';

export type GoalRow = typeof agentDirectorGoals.$inferSelect;

export interface CreateGoalInput {
  title: string;
  description: string;
  domain: SignalDomain;
  priority: string;
  ownerUserId?: number;
  startDate: Date;
  targetDate: Date;
  targetType: GoalTargetType;
  targetValue?: number;
  unit?: string;
  metadata: Record<string, unknown>;
}

async function assertUserExists(userId: number) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new AgentError('validation_error', 'Usuário informado não existe.');
}

/**
 * Agentes v2.0 (correio.md seção 2) — Goal nasce sempre `draft` (nunca
 * `active` diretamente — `POST /goals/:id/activate` é uma transição
 * explícita e auditada, seção 15: "criar algo semelhante a... activate").
 */
export async function createGoal(input: CreateGoalInput, createdBy: number): Promise<GoalRow> {
  if (input.ownerUserId) await assertUserExists(input.ownerUserId);

  const now = new Date();
  const [goal] = await db
    .insert(agentDirectorGoals)
    .values({
      title: input.title,
      description: input.description,
      domain: input.domain,
      status: 'draft',
      priority: input.priority,
      ownerUserId: input.ownerUserId ?? null,
      createdBy,
      startDate: input.startDate,
      targetDate: input.targetDate,
      targetType: input.targetType,
      targetValue: input.targetValue !== undefined ? String(input.targetValue) : null,
      unit: input.unit ?? null,
      progressPercent: 0,
      health: 'unknown',
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await audit({
    userId: createdBy,
    actorType: 'user',
    actorId: String(createdBy),
    action: 'agents.director.goal.created',
    entityType: 'agent_director_goal',
    entityId: String(goal!.id),
    metadata: { title: goal!.title, domain: goal!.domain, targetType: goal!.targetType },
  });

  return goal!;
}

export interface ListGoalsParams {
  page: number;
  limit: number;
  status?: GoalStatus;
  domain?: SignalDomain;
  health?: GoalHealth;
  ownerUserId?: number;
}

export async function listGoals(params: ListGoalsParams) {
  const conditions: SQL[] = [];
  if (params.status) conditions.push(eq(agentDirectorGoals.status, params.status));
  if (params.domain) conditions.push(eq(agentDirectorGoals.domain, params.domain));
  if (params.health) conditions.push(eq(agentDirectorGoals.health, params.health));
  if (params.ownerUserId) conditions.push(eq(agentDirectorGoals.ownerUserId, params.ownerUserId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentDirectorGoals)
      .where(where)
      .orderBy(asc(agentDirectorGoals.targetDate), asc(agentDirectorGoals.id))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentDirectorGoals).where(where),
  ]);

  return { rows, total: Number(total) };
}

export async function getGoalById(id: number): Promise<GoalRow | null> {
  const [row] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, id)).limit(1);
  return row ?? null;
}

export async function getGoalMetrics(goalId: number) {
  return db.select().from(agentDirectorGoalMetrics).where(eq(agentDirectorGoalMetrics.goalId, goalId));
}

export async function getGoalEvaluationHistory(goalId: number, limit = 30) {
  return db
    .select()
    .from(agentDirectorGoalEvaluations)
    .where(eq(agentDirectorGoalEvaluations.goalId, goalId))
    .orderBy(asc(agentDirectorGoalEvaluations.evaluatedAt))
    .limit(limit);
}

export interface UpdateGoalInput {
  title?: string;
  description?: string;
  priority?: string;
  ownerUserId?: number | null;
  targetDate?: Date;
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string | null;
}

export async function updateGoal(goal: GoalRow, input: UpdateGoalInput, actorUserId: number): Promise<GoalRow> {
  if (input.ownerUserId) await assertUserExists(input.ownerUserId);

  const now = new Date();
  const [updated] = await db
    .update(agentDirectorGoals)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
      ...(input.targetValue !== undefined ? { targetValue: input.targetValue !== null ? String(input.targetValue) : null } : {}),
      ...(input.currentValue !== undefined ? { currentValue: input.currentValue !== null ? String(input.currentValue) : null } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      updatedAt: now,
    })
    .where(eq(agentDirectorGoals.id, goal.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.goal.updated',
    entityType: 'agent_director_goal',
    entityId: String(goal.id),
    metadata: { fields: Object.keys(input) },
  });

  return updated!;
}

/** open (draft|paused) -> active. */
export async function activateGoal(goal: GoalRow, actorUserId: number): Promise<GoalRow> {
  if (goal.status !== 'draft' && goal.status !== 'paused') {
    throw new AgentError('conflict', `Goal está "${goal.status}" — só pode ser ativado a partir de "draft" ou "paused".`);
  }

  const [updated] = await db
    .update(agentDirectorGoals)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(agentDirectorGoals.id, goal.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.goal.activated',
    entityType: 'agent_director_goal',
    entityId: String(goal.id),
    metadata: { previousStatus: goal.status },
  });

  return updated!;
}

/** active -> paused. */
export async function pauseGoal(goal: GoalRow, actorUserId: number): Promise<GoalRow> {
  if (goal.status !== 'active') {
    throw new AgentError('conflict', `Goal está "${goal.status}" — só pode ser pausado a partir de "active".`);
  }

  const [updated] = await db
    .update(agentDirectorGoals)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(agentDirectorGoals.id, goal.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.goal.paused',
    entityType: 'agent_director_goal',
    entityId: String(goal.id),
    metadata: { previousStatus: goal.status },
  });

  return updated!;
}

/** Qualquer estado não-terminal -> cancelled. Soft state, reason obrigatório. */
export async function cancelGoal(goal: GoalRow, reason: string, actorUserId: number): Promise<GoalRow> {
  if (goal.status === 'achieved' || goal.status === 'missed' || goal.status === 'cancelled') {
    throw new AgentError('conflict', `Goal já está "${goal.status}" — não pode ser cancelado.`);
  }

  const now = new Date();
  const [updated] = await db
    .update(agentDirectorGoals)
    .set({ status: 'cancelled', cancelledAt: now, cancellationReason: reason, updatedAt: now })
    .where(eq(agentDirectorGoals.id, goal.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.goal.cancelled',
    entityType: 'agent_director_goal',
    entityId: String(goal.id),
    metadata: { reason, previousStatus: goal.status },
  });

  return updated!;
}

export interface AddGoalMetricInput {
  metricKey: string;
  targetValue: number;
  weight: number;
  direction?: string;
}

/**
 * Agentes v2.0 (correio.md seção 4) — `metricKey` DEVE existir no
 * catálogo determinístico; nunca aceita uma chave arbitrária.
 */
export async function addGoalMetric(goal: GoalRow, input: AddGoalMetricInput, actorUserId: number) {
  const catalogEntry = getMetricCatalogEntry(input.metricKey);
  if (!catalogEntry) {
    throw new AgentError('validation_error', `metricKey "${input.metricKey}" não existe no catálogo de métricas.`);
  }

  const now = new Date();

  try {
    const [metric] = await db
      .insert(agentDirectorGoalMetrics)
      .values({
        goalId: goal.id,
        metricKey: catalogEntry.key,
        label: catalogEntry.label,
        sourceDomain: catalogEntry.domain,
        targetValue: String(input.targetValue),
        unit: catalogEntry.unit,
        direction: input.direction ?? catalogEntry.defaultDirection,
        weight: input.weight,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await audit({
      userId: actorUserId,
      actorType: 'user',
      actorId: String(actorUserId),
      action: 'agents.director.goal.metric_added',
      entityType: 'agent_director_goal',
      entityId: String(goal.id),
      metadata: { metricKey: catalogEntry.key, targetValue: input.targetValue },
    });

    return metric!;
  } catch (error) {
    // uniqueIndex(goal_id, metric_key) — mesma métrica já associada.
    throw new AgentError('conflict', `Métrica "${input.metricKey}" já está associada a este Goal.`, error);
  }
}

export async function getGoalsOverview(now: Date = new Date()) {
  const activeGoals = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.status, 'active'));

  const critical = activeGoals.filter((goal) => goal.health === 'critical');
  const atRisk = activeGoals.filter((goal) => goal.health === 'at_risk');
  const attention = activeGoals.filter((goal) => goal.health === 'attention');
  const deadlineNear = activeGoals.filter((goal) => {
    const daysRemaining = (goal.targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    return daysRemaining >= 0 && daysRemaining <= 14;
  });
  const withoutOwner = activeGoals.filter((goal) => !goal.ownerUserId);

  return {
    generatedAt: now.toISOString(),
    activeTotal: activeGoals.length,
    critical,
    atRisk,
    attention,
    deadlineNear,
    withoutOwner,
  };
}
