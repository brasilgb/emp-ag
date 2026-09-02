import { and, asc, count, desc, eq, inArray, SQL } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentActionPlanItems, agentApprovals, agentDirectorInitiatives, users } from '../../../db/schema/index.js';
import { AgentError } from '../../errors.js';
import { audit } from '../../../services/audit.js';
import type { SignalDomain } from '../types.js';

import type { GoalRow } from './goals-service.js';
import { assertInitiativeTransition } from './initiatives-lifecycle.js';
import type { InitiativeStatus } from './types.js';

export type InitiativeRow = typeof agentDirectorInitiatives.$inferSelect;

async function assertUserExists(userId: number) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new AgentError('validation_error', 'Usuário informado não existe.');
}

export interface CreateInitiativeInput {
  title: string;
  description: string;
  domain: SignalDomain;
  priority: string;
  rationale: string;
  expectedImpact?: string;
  ownerUserId?: number;
  targetDate?: Date;
}

/**
 * Agentes v2.0 (correio.md seção 10) — origem manual: CEO/Diretor cria a
 * Initiative diretamente. `origin='director_recommendation'` só nasce
 * via `review-service.ts` (recommendKey obrigatório lá, nunca aqui).
 */
export async function createInitiative(goal: GoalRow, input: CreateInitiativeInput, createdBy: number): Promise<InitiativeRow> {
  if (input.ownerUserId) await assertUserExists(input.ownerUserId);

  const now = new Date();
  const [initiative] = await db
    .insert(agentDirectorInitiatives)
    .values({
      goalId: goal.id,
      title: input.title,
      description: input.description,
      domain: input.domain,
      status: 'proposed',
      priority: input.priority,
      rationale: input.rationale,
      expectedImpact: input.expectedImpact ?? null,
      origin: 'manual',
      ownerUserId: input.ownerUserId ?? null,
      createdBy,
      targetDate: input.targetDate ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await audit({
    userId: createdBy,
    actorType: 'user',
    actorId: String(createdBy),
    action: 'agents.director.initiative.created',
    entityType: 'agent_director_initiative',
    entityId: String(initiative!.id),
    metadata: { goalId: goal.id, title: initiative!.title, origin: 'manual' },
  });

  return initiative!;
}

export interface ListInitiativesParams {
  page: number;
  limit: number;
  goalId?: number;
  status?: InitiativeStatus;
}

export async function listInitiatives(params: ListInitiativesParams) {
  const conditions: SQL[] = [];
  if (params.goalId) conditions.push(eq(agentDirectorInitiatives.goalId, params.goalId));
  if (params.status) conditions.push(eq(agentDirectorInitiatives.status, params.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentDirectorInitiatives)
      .where(where)
      .orderBy(desc(agentDirectorInitiatives.createdAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentDirectorInitiatives).where(where),
  ]);

  return { rows, total: Number(total) };
}

export async function getInitiativeById(id: number): Promise<InitiativeRow | null> {
  const [row] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id)).limit(1);
  return row ?? null;
}

export async function getPendingApprovalForInitiative(actionPlanId: number | null) {
  if (!actionPlanId) return null;

  const items = await db.select({ id: agentActionPlanItems.id }).from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, actionPlanId));
  if (items.length === 0) return null;

  const [pending] = await db
    .select()
    .from(agentApprovals)
    .where(and(inArray(agentApprovals.planItemId, items.map((item) => item.id)), eq(agentApprovals.status, 'pending')))
    .orderBy(desc(agentApprovals.createdAt))
    .limit(1);

  return pending ?? null;
}

export interface UpdateInitiativeInput {
  title?: string;
  description?: string;
  priority?: string;
  ownerUserId?: number | null;
  targetDate?: Date | null;
}

export async function updateInitiative(initiative: InitiativeRow, input: UpdateInitiativeInput, actorUserId: number): Promise<InitiativeRow> {
  if (input.ownerUserId) await assertUserExists(input.ownerUserId);

  const now = new Date();
  const [updated] = await db
    .update(agentDirectorInitiatives)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
      updatedAt: now,
    })
    .where(eq(agentDirectorInitiatives.id, initiative.id))
    .returning();

  return updated!;
}

/** proposed -> approved. */
export async function approveInitiative(initiative: InitiativeRow, actorUserId: number): Promise<InitiativeRow> {
  assertInitiativeTransition(initiative.status, 'approved');

  const [updated] = await db
    .update(agentDirectorInitiatives)
    .set({ status: 'approved', updatedAt: new Date() })
    .where(eq(agentDirectorInitiatives.id, initiative.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.initiative.approved',
    entityType: 'agent_director_initiative',
    entityId: String(initiative.id),
    metadata: { goalId: initiative.goalId, previousStatus: initiative.status },
  });

  return updated!;
}

/** proposed|approved|active|blocked -> cancelled. Reason obrigatório, soft state. */
export async function cancelInitiative(initiative: InitiativeRow, reason: string, actorUserId: number): Promise<InitiativeRow> {
  assertInitiativeTransition(initiative.status, 'cancelled');

  const now = new Date();
  const [updated] = await db
    .update(agentDirectorInitiatives)
    .set({ status: 'cancelled', cancelledAt: now, cancellationReason: reason, updatedAt: now })
    .where(eq(agentDirectorInitiatives.id, initiative.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.initiative.cancelled',
    entityType: 'agent_director_initiative',
    entityId: String(initiative.id),
    metadata: { goalId: initiative.goalId, reason, previousStatus: initiative.status },
  });

  return updated!;
}

// Conclusão manual (`POST .../complete`) mudou-se para
// `initiatives-execution-service.ts` na v2.1 — saneamento seção 2:
// "active → completed" só é permitido quando a MESMA evidência
// determinística da conclusão automática já existe
// (`executionState==='completed'`), nunca antes disso — por isso o
// método (`completeInitiativeManually`) precisa da visão de execução
// (`getInitiativeExecutionView`), que vive no serviço de execução, não
// aqui. Este arquivo continua dono só do CRUD/lifecycle simples da
// Initiative que NÃO depende de evidência de execução (approve/cancel).

// A criação/execução do Action Plan (antigo `proposeActionForInitiative`)
// mudou-se para `initiatives-execution-service.ts` na v2.1 — agora
// `startInitiativeExecution()`, com claim atômico (idempotência real,
// correio.md v2.1 seção 3) e sincronização de progresso/conclusão
// automática (seções 6-9). Este arquivo continua dono só do CRUD/
// lifecycle simples da Initiative.
