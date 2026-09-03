import { and, count, desc, eq, SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentResponsibilities, agents, users } from '../../db/schema/index.js';
import { AgentError } from '../errors.js';
import { audit } from '../../services/audit.js';

import type { EscalationPolicy, ResponsibilityPriority, ResponsibilityType } from './types.js';

export type ResponsibilityRow = typeof agentResponsibilities.$inferSelect;

async function assertAgentExists(agentId: number): Promise<void> {
  const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!row) throw new AgentError('validation_error', 'Agent informado não existe.');
}

async function assertUserExists(userId: number): Promise<void> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new AgentError('validation_error', 'Usuário informado não existe.');
}

/**
 * Agentes v2.6 (correio.md seção 28) — segunda camada de validação
 * (a primeira é o Zod `.refine()` de `schemas.ts`, só cobre `POST`
 * completo) — aqui valida a combinação FINAL (existente + patch) antes
 * de qualquer `UPDATE`, cobrindo `PATCH` parcial. O CHECK constraint no
 * banco (`schema/agent-responsibilities.ts`) é a terceira e definitiva
 * camada, nunca contornável.
 */
function assertEscalationTargetMatchesPolicy(policy: EscalationPolicy, targetAgentId: number | null, targetUserId: number | null): void {
  const needsAgent = policy === 'agent' || policy === 'agent_then_human';
  const needsUser = policy === 'human' || policy === 'agent_then_human';

  if (needsAgent && !targetAgentId) {
    throw new AgentError('validation_error', `escalationPolicy "${policy}" exige escalationTargetAgentId.`);
  }
  if (needsUser && !targetUserId) {
    throw new AgentError('validation_error', `escalationPolicy "${policy}" exige escalationTargetUserId.`);
  }
}

export interface CreateResponsibilityInput {
  agentId: number;
  name: string;
  description?: string;
  domain: string;
  responsibilityType: ResponsibilityType;
  priority: ResponsibilityPriority;
  conditions: Record<string, unknown>;
  escalationPolicy: EscalationPolicy;
  escalationTargetAgentId?: number;
  escalationTargetUserId?: number;
}

export async function createResponsibility(input: CreateResponsibilityInput, createdBy: number): Promise<ResponsibilityRow> {
  await assertAgentExists(input.agentId);
  if (input.escalationTargetAgentId) await assertAgentExists(input.escalationTargetAgentId);
  if (input.escalationTargetUserId) await assertUserExists(input.escalationTargetUserId);
  assertEscalationTargetMatchesPolicy(input.escalationPolicy, input.escalationTargetAgentId ?? null, input.escalationTargetUserId ?? null);

  const now = new Date();
  const [row] = await db
    .insert(agentResponsibilities)
    .values({
      agentId: input.agentId,
      name: input.name,
      description: input.description ?? null,
      domain: input.domain,
      responsibilityType: input.responsibilityType,
      priority: input.priority,
      conditions: input.conditions,
      escalationPolicy: input.escalationPolicy,
      escalationTargetAgentId: input.escalationTargetAgentId ?? null,
      escalationTargetUserId: input.escalationTargetUserId ?? null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await audit({
    userId: createdBy,
    actorType: 'user',
    actorId: String(createdBy),
    action: 'agents.responsibility.created',
    entityType: 'agent_responsibility',
    entityId: String(row!.id),
    metadata: { agentId: input.agentId, domain: input.domain, responsibilityType: input.responsibilityType, escalationPolicy: input.escalationPolicy },
  });

  return row!;
}

export interface ListResponsibilitiesParams {
  page: number;
  limit: number;
  agentId?: number;
  domain?: string;
  responsibilityType?: ResponsibilityType;
  enabled?: boolean;
}

export async function listResponsibilities(params: ListResponsibilitiesParams) {
  const conditions: SQL[] = [];
  if (params.agentId) conditions.push(eq(agentResponsibilities.agentId, params.agentId));
  if (params.domain) conditions.push(eq(agentResponsibilities.domain, params.domain));
  if (params.responsibilityType) conditions.push(eq(agentResponsibilities.responsibilityType, params.responsibilityType));
  if (params.enabled !== undefined) conditions.push(eq(agentResponsibilities.enabled, params.enabled));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentResponsibilities)
      .where(where)
      .orderBy(desc(agentResponsibilities.createdAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentResponsibilities).where(where),
  ]);

  return { rows, total: Number(total) };
}

export async function getResponsibilityById(id: number): Promise<ResponsibilityRow | null> {
  const [row] = await db.select().from(agentResponsibilities).where(eq(agentResponsibilities.id, id)).limit(1);
  return row ?? null;
}

export interface UpdateResponsibilityInput {
  name?: string;
  description?: string | null;
  priority?: ResponsibilityPriority;
  conditions?: Record<string, unknown>;
  enabled?: boolean;
  escalationPolicy?: EscalationPolicy;
  escalationTargetAgentId?: number | null;
  escalationTargetUserId?: number | null;
}

export async function updateResponsibility(responsibility: ResponsibilityRow, input: UpdateResponsibilityInput, actorUserId: number): Promise<ResponsibilityRow> {
  const nextPolicy = input.escalationPolicy ?? (responsibility.escalationPolicy as EscalationPolicy);
  const nextTargetAgentId = input.escalationTargetAgentId !== undefined ? input.escalationTargetAgentId : responsibility.escalationTargetAgentId;
  const nextTargetUserId = input.escalationTargetUserId !== undefined ? input.escalationTargetUserId : responsibility.escalationTargetUserId;

  if (nextTargetAgentId) await assertAgentExists(nextTargetAgentId);
  if (nextTargetUserId) await assertUserExists(nextTargetUserId);
  assertEscalationTargetMatchesPolicy(nextPolicy, nextTargetAgentId, nextTargetUserId);

  const now = new Date();
  const wasEnabled = responsibility.enabled;

  const [updated] = await db
    .update(agentResponsibilities)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      escalationPolicy: nextPolicy,
      escalationTargetAgentId: nextTargetAgentId,
      escalationTargetUserId: nextTargetUserId,
      updatedAt: now,
    })
    .where(eq(agentResponsibilities.id, responsibility.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.responsibility.updated',
    entityType: 'agent_responsibility',
    entityId: String(responsibility.id),
    metadata: { changes: input },
  });

  // Seção 20: "não criar eventos redundantes" — enabled/disabled só
  // audita quando o VALOR de fato mudou (nunca um segundo evento
  // idêntico a `updated` quando `enabled` nem estava no payload).
  if (input.enabled !== undefined && input.enabled !== wasEnabled) {
    await audit({
      userId: actorUserId,
      actorType: 'user',
      actorId: String(actorUserId),
      action: input.enabled ? 'agents.responsibility.enabled' : 'agents.responsibility.disabled',
      entityType: 'agent_responsibility',
      entityId: String(responsibility.id),
      metadata: {},
    });
  }

  return updated!;
}

/**
 * Agentes v2.6 (correio.md seção 31) — "preferência arquitetural:
 * disabled para entidades que tenham histórico". Exclusão real só é
 * permitida quando NÃO existe nenhuma escalation associada (histórico
 * vazio) — quando existe, o FK `onDelete: 'restrict'`
 * (schema/agent-operational-escalations.ts) faria o DELETE falhar de
 * qualquer forma; esta checagem prévia só devolve um erro amigável
 * (409) em vez de deixar o Postgres estourar uma constraint crua.
 */
export async function deleteResponsibility(responsibility: ResponsibilityRow, actorUserId: number): Promise<void> {
  const [{ total }] = await db.select({ total: count() }).from(agentOperationalEscalations).where(eq(agentOperationalEscalations.responsibilityId, responsibility.id));

  if (Number(total) > 0) {
    throw new AgentError('conflict', 'Esta Responsibility possui histórico de escalations — não pode ser excluída. Desabilite-a em vez de excluir.');
  }

  await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, responsibility.id));

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.responsibility.deleted',
    entityType: 'agent_responsibility',
    entityId: String(responsibility.id),
    metadata: { agentId: responsibility.agentId, domain: responsibility.domain },
  });
}
