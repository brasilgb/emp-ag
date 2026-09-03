import { randomUUID } from 'node:crypto';

import { and, count, desc, eq, lt, notInArray, SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentOperationalFollowUps, agentResponsibilities, users } from '../../db/schema/index.js';
import { AgentError } from '../errors.js';
import { audit } from '../../services/audit.js';

import { FOLLOW_UP_TRANSITIONS } from './types.js';
import type { FollowUpPriority, FollowUpStatus } from './types.js';

export type FollowUpRow = typeof agentOperationalFollowUps.$inferSelect;
type ResponsibilityRow = typeof agentResponsibilities.$inferSelect;
type EscalationRow = typeof agentOperationalEscalations.$inferSelect;

async function assertUserExists(userId: number): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new AgentError('validation_error', 'Usuário informado não existe.');
}

export async function getResponsibilityForFollowUp(id: number): Promise<ResponsibilityRow | null> {
  const [row] = await db.select().from(agentResponsibilities).where(eq(agentResponsibilities.id, id)).limit(1);
  return row ?? null;
}

function assertTransition(current: FollowUpStatus, target: FollowUpStatus): void {
  const allowed = FOLLOW_UP_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new AgentError('conflict', `FollowUp está "${current}" — transição para "${target}" não é permitida.`);
  }
}

/**
 * Agentes v2.7 (correio.md seção 6.B) — criação gerencial direta,
 * associada a uma Responsibility real (nunca inventa ownership: o dono é
 * sempre `responsibility.agentId`, cópia congelada no momento da criação
 * — mesmo princípio de `agent_operational_escalations.sourceAgentId`).
 */
export interface CreateManualFollowUpInput {
  responsibilityId: number;
  title: string;
  description?: string;
  priority: FollowUpPriority;
  assignedUserId?: number;
  dueAt?: Date;
  nextReviewAt?: Date;
}

export async function createManualFollowUp(input: CreateManualFollowUpInput, createdBy: number): Promise<FollowUpRow> {
  const responsibility = await getResponsibilityForFollowUp(input.responsibilityId);
  if (!responsibility) throw new AgentError('validation_error', 'Responsibility informada não existe.');
  if (input.assignedUserId) await assertUserExists(input.assignedUserId);

  const now = new Date();
  const [row] = await db
    .insert(agentOperationalFollowUps)
    .values({
      responsibilityId: responsibility.id,
      escalationId: null,
      sourceType: 'responsibility',
      sourceId: responsibility.id,
      ownerAgentId: responsibility.agentId,
      assignedUserId: input.assignedUserId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: 'open',
      priority: input.priority,
      dueAt: input.dueAt ?? null,
      nextReviewAt: input.nextReviewAt ?? null,
      dedupKey: `manual:${responsibility.id}:${randomUUID()}`,
      metadata: {},
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await audit({
    userId: createdBy,
    actorType: 'user',
    actorId: String(createdBy),
    action: 'agents.followup.created',
    entityType: 'agent_operational_follow_up',
    entityId: String(row!.id),
    metadata: { responsibilityId: responsibility.id, sourceType: 'responsibility' },
  });

  return row!;
}

/**
 * Agentes v2.7 (correio.md seções 6.A/7/8) — ÚNICO ponto de criação
 * automática, chamado internamente por
 * `escalations/supervisor-integration.ts` logo após uma escalation ser
 * criada/reaberta com sucesso — nunca a partir do Supervisor
 * diretamente (evita duplicar a responsabilidade de ownership já
 * resolvida pela v2.6, seção 6.C). `dedupKey = escalation:${escalationId}`:
 * a escalation já é o evento deduplicado (v2.6) — um FollowUp por
 * escalation é suficiente. Mesmo padrão atômico de
 * `escalations/service.ts:createOrReopenEscalation` — INSERT com
 * `ON CONFLICT DO NOTHING`, e uma transação curta com `SELECT ... FOR
 * UPDATE` na trilha de conflito para decidir reabrir ou devolver como
 * está (nunca um SELECT-then-INSERT desprotegido).
 */
export async function createOrReopenFollowUpFromEscalation(params: {
  escalation: EscalationRow;
  responsibility: ResponsibilityRow;
}): Promise<{ followUp: FollowUpRow; created: boolean; reopened: boolean }> {
  const { escalation, responsibility } = params;
  const dedupKey = `escalation:${escalation.id}`;
  const now = new Date();

  const title = escalation.reason.length > 200 ? `${escalation.reason.slice(0, 197)}...` : escalation.reason;

  const baseValues = {
    responsibilityId: responsibility.id,
    escalationId: escalation.id,
    sourceType: 'escalation' as const,
    sourceId: escalation.id,
    ownerAgentId: responsibility.agentId,
    assignedUserId: escalation.targetUserId,
    title,
    description: escalation.reason,
    status: 'open' as const,
    priority: priorityFromSeverity(escalation.severity),
    dedupKey,
    metadata: { escalationId: escalation.id, responsibilityId: responsibility.id },
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await db.insert(agentOperationalFollowUps).values(baseValues).onConflictDoNothing({ target: agentOperationalFollowUps.dedupKey }).returning();

  if (inserted.length > 0) {
    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agents.followup.created',
      entityType: 'agent_operational_follow_up',
      entityId: String(inserted[0]!.id),
      metadata: { escalationId: escalation.id, responsibilityId: responsibility.id, sourceType: 'escalation' },
    });
    return { followUp: inserted[0]!, created: true, reopened: false };
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.dedupKey, dedupKey)).for('update');

    if (!existing) {
      const [created] = await tx
        .insert(agentOperationalFollowUps)
        .values(baseValues)
        .onConflictDoNothing({ target: agentOperationalFollowUps.dedupKey })
        .returning();
      return { followUp: created!, created: true, reopened: false };
    }

    const shouldReopen = existing.status === 'completed' || existing.status === 'dismissed';
    if (!shouldReopen) {
      return { followUp: existing, created: false, reopened: false };
    }

    const [reopened] = await tx
      .update(agentOperationalFollowUps)
      .set({
        status: 'open',
        priority: priorityFromSeverity(escalation.severity),
        description: escalation.reason,
        completedAt: null,
        completedBy: null,
        resolution: null,
        dismissedAt: null,
        dismissedBy: null,
        dismissReason: null,
        acknowledgedAt: null,
        waitingReason: null,
        waitingUntil: null,
        updatedAt: now,
      })
      .where(eq(agentOperationalFollowUps.id, existing.id))
      .returning();

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agents.followup.reopened',
      entityType: 'agent_operational_follow_up',
      entityId: String(reopened!.id),
      metadata: { escalationId: escalation.id, responsibilityId: responsibility.id },
    });

    return { followUp: reopened!, created: false, reopened: true };
  });
}

/**
 * Agentes v2.7 (correio.md seção 8) — mapeamento determinístico de
 * severity (Escalation, v2.6) para priority (FollowUp) — nunca LLM,
 * nunca herdado silenciosamente sem uma regra explícita.
 */
function priorityFromSeverity(severity: string): FollowUpPriority {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning') return 'high';
  return 'medium';
}

export async function getFollowUpById(id: number): Promise<FollowUpRow | null> {
  const [row] = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, id)).limit(1);
  return row ?? null;
}

export interface ListFollowUpsParams {
  page: number;
  limit: number;
  status?: FollowUpStatus;
  priority?: FollowUpPriority;
  ownerAgentId?: number;
  assignedUserId?: number;
  responsibilityId?: number;
  escalationId?: number;
  overdue?: boolean;
}

const TERMINAL_STATUSES: FollowUpStatus[] = ['completed', 'dismissed'];

export async function listFollowUps(params: ListFollowUpsParams) {
  const conditions: SQL[] = [];
  if (params.status) conditions.push(eq(agentOperationalFollowUps.status, params.status));
  if (params.priority) conditions.push(eq(agentOperationalFollowUps.priority, params.priority));
  if (params.ownerAgentId) conditions.push(eq(agentOperationalFollowUps.ownerAgentId, params.ownerAgentId));
  if (params.assignedUserId) conditions.push(eq(agentOperationalFollowUps.assignedUserId, params.assignedUserId));
  if (params.responsibilityId) conditions.push(eq(agentOperationalFollowUps.responsibilityId, params.responsibilityId));
  if (params.escalationId) conditions.push(eq(agentOperationalFollowUps.escalationId, params.escalationId));
  if (params.overdue) {
    conditions.push(lt(agentOperationalFollowUps.dueAt, new Date()));
    conditions.push(notInArray(agentOperationalFollowUps.status, TERMINAL_STATUSES));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentOperationalFollowUps)
      .where(where)
      .orderBy(desc(agentOperationalFollowUps.createdAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentOperationalFollowUps).where(where),
  ]);

  return { rows, total: Number(total) };
}

/**
 * Agentes v2.7 (correio.md seção 3, campo `acknowledgedAt`) — a seção 4
 * não define um estado "acknowledged" separado; mapeado deliberadamente
 * para a transição real `open → in_progress` ("iniciar"). Só grava
 * `acknowledgedAt` na primeira vez (nunca sobrescreve um valor já
 * existente — preserva quando o acompanhamento REALMENTE começou, mesmo
 * que o FollowUp volte de `waiting` para `in_progress` depois).
 */
export async function startFollowUp(followUp: FollowUpRow, userId: number): Promise<FollowUpRow> {
  assertTransition(followUp.status as FollowUpStatus, 'in_progress');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalFollowUps)
    .set({ status: 'in_progress', acknowledgedAt: followUp.acknowledgedAt ?? now, updatedAt: now })
    .where(eq(agentOperationalFollowUps.id, followUp.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.followup.started',
    entityType: 'agent_operational_follow_up',
    entityId: String(followUp.id),
    metadata: { previousStatus: followUp.status },
  });

  return updated!;
}

export interface WaitFollowUpInput {
  waitingReason: string;
  waitingUntil?: Date;
}

export async function waitFollowUp(followUp: FollowUpRow, input: WaitFollowUpInput, userId: number): Promise<FollowUpRow> {
  assertTransition(followUp.status as FollowUpStatus, 'waiting');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalFollowUps)
    .set({ status: 'waiting', waitingReason: input.waitingReason, waitingUntil: input.waitingUntil ?? null, updatedAt: now })
    .where(eq(agentOperationalFollowUps.id, followUp.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.followup.waiting',
    entityType: 'agent_operational_follow_up',
    entityId: String(followUp.id),
    metadata: { previousStatus: followUp.status, waitingReason: input.waitingReason },
  });

  return updated!;
}

export async function resumeFollowUp(followUp: FollowUpRow, userId: number): Promise<FollowUpRow> {
  assertTransition(followUp.status as FollowUpStatus, 'in_progress');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalFollowUps)
    .set({ status: 'in_progress', waitingReason: null, waitingUntil: null, updatedAt: now })
    .where(eq(agentOperationalFollowUps.id, followUp.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.followup.resumed',
    entityType: 'agent_operational_follow_up',
    entityId: String(followUp.id),
    metadata: { previousStatus: followUp.status },
  });

  return updated!;
}

export async function completeFollowUp(followUp: FollowUpRow, resolution: string, userId: number): Promise<FollowUpRow> {
  assertTransition(followUp.status as FollowUpStatus, 'completed');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalFollowUps)
    .set({ status: 'completed', completedAt: now, completedBy: userId, resolution, updatedAt: now })
    .where(eq(agentOperationalFollowUps.id, followUp.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.followup.completed',
    entityType: 'agent_operational_follow_up',
    entityId: String(followUp.id),
    metadata: { previousStatus: followUp.status },
  });

  return updated!;
}

export async function dismissFollowUp(followUp: FollowUpRow, reason: string, userId: number): Promise<FollowUpRow> {
  assertTransition(followUp.status as FollowUpStatus, 'dismissed');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalFollowUps)
    .set({ status: 'dismissed', dismissedAt: now, dismissedBy: userId, dismissReason: reason, updatedAt: now })
    .where(eq(agentOperationalFollowUps.id, followUp.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.followup.dismissed',
    entityType: 'agent_operational_follow_up',
    entityId: String(followUp.id),
    metadata: { previousStatus: followUp.status, reason },
  });

  return updated!;
}

/**
 * Agentes v2.7 (correio.md seção 9) — reassignment é só do
 * `assignedUserId` (humano); `ownerAgentId` permanece a cópia congelada
 * do dono real no momento da criação, NUNCA reescrita — reassignment
 * nunca reescreve o histórico anterior (auditado com o valor anterior).
 */
export async function reassignFollowUp(followUp: FollowUpRow, assignedUserId: number | null, userId: number): Promise<FollowUpRow> {
  if (followUp.status === 'completed' || followUp.status === 'dismissed') {
    throw new AgentError('conflict', `FollowUp está "${followUp.status}" — não é possível reatribuir um FollowUp terminal.`);
  }
  if (assignedUserId !== null) await assertUserExists(assignedUserId);

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalFollowUps)
    .set({ assignedUserId, updatedAt: now })
    .where(eq(agentOperationalFollowUps.id, followUp.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.followup.reassigned',
    entityType: 'agent_operational_follow_up',
    entityId: String(followUp.id),
    metadata: { previousAssignedUserId: followUp.assignedUserId, newAssignedUserId: assignedUserId },
  });

  return updated!;
}
