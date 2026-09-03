import { and, count, desc, eq, SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations } from '../../db/schema/index.js';
import { AgentError } from '../errors.js';
import { audit } from '../../services/audit.js';

import { ESCALATION_TRANSITIONS } from './types.js';
import type { EscalationSeverity, EscalationStatus } from './types.js';

export type EscalationRow = typeof agentOperationalEscalations.$inferSelect;

function assertTransition(current: EscalationStatus, target: EscalationStatus): void {
  const allowed = ESCALATION_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw new AgentError('conflict', `Escalation está "${current}" — transição para "${target}" não é permitida.`);
  }
}

export interface CreateOrReopenEscalationInput {
  responsibilityId: number;
  sourceAgentId: number;
  targetAgentId: number | null;
  targetUserId: number | null;
  reason: string;
  severity: EscalationSeverity;
  entityType?: string | null;
  entityId?: number | null;
  dedupKey: string;
  metadata?: Record<string, unknown>;
}

/**
 * Agentes v2.6 (correio.md seções 14/15/27, "critério bloqueante") —
 * ÚNICO ponto de criação real de escalation (seção 19: nenhum endpoint
 * público de criação livre existe — só chamado internamente pela
 * integração com o Operational Supervisor). Idempotente e seguro sob
 * concorrência via `INSERT ... ON CONFLICT (dedup_key) DO NOTHING`
 * (mesmo padrão atômico já usado em `decisions/sync-service.ts:upsertSignal`
 * desde a v1.9) — NUNCA find-then-insert desprotegido.
 *
 * Reocorrência (seção 33 item 21, decisão documentada — mesmo padrão de
 * `goals/review-service.ts` "saneamento seção 5"): se já existe uma
 * linha com o MESMO `dedupKey` e ela está `resolved`/`dismissed`,
 * REABRE a mesma linha (nunca insere uma segunda) — volta para `open`,
 * limpa os campos terminais, atualiza `reason`/`metadata` para o
 * contexto atual. Se a linha existente ainda está `open`/`acknowledged`,
 * é um NO-OP real (dedup funcionando — seção 15: "crítério bloqueante",
 * nunca gera centenas de escalations iguais).
 */
export async function createOrReopenEscalation(input: CreateOrReopenEscalationInput): Promise<{ escalation: EscalationRow; created: boolean; reopened: boolean }> {
  const now = new Date();

  const inserted = await db
    .insert(agentOperationalEscalations)
    .values({
      responsibilityId: input.responsibilityId,
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      targetUserId: input.targetUserId,
      reason: input.reason,
      severity: input.severity,
      status: 'open',
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      dedupKey: input.dedupKey,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: agentOperationalEscalations.dedupKey })
    .returning();

  if (inserted.length > 0) {
    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agents.escalation.created',
      entityType: 'agent_operational_escalation',
      entityId: String(inserted[0]!.id),
      metadata: { responsibilityId: input.responsibilityId, severity: input.severity, targetAgentId: input.targetAgentId, targetUserId: input.targetUserId },
    });
    return { escalation: inserted[0]!, created: true, reopened: false };
  }

  // Corrida perdida ou reocorrência — lê a linha real (transação curta
  // com lock, mesmo padrão de `upsertSignal`) para decidir reabrir ou
  // devolver como está.
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(agentOperationalEscalations).where(eq(agentOperationalEscalations.dedupKey, input.dedupKey)).for('update');

    if (!existing) {
      // Corrida extrema (linha sumiu entre o INSERT e este SELECT —
      // nunca deveria acontecer, nada aqui deleta linhas). Fail-safe:
      // trata como nova criação.
      const [created] = await tx
        .insert(agentOperationalEscalations)
        .values({
          responsibilityId: input.responsibilityId,
          sourceAgentId: input.sourceAgentId,
          targetAgentId: input.targetAgentId,
          targetUserId: input.targetUserId,
          reason: input.reason,
          severity: input.severity,
          status: 'open',
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          dedupKey: input.dedupKey,
          metadata: input.metadata ?? {},
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: agentOperationalEscalations.dedupKey })
        .returning();
      return { escalation: created!, created: true, reopened: false };
    }

    const shouldReopen = existing.status === 'resolved' || existing.status === 'dismissed';

    if (!shouldReopen) {
      return { escalation: existing, created: false, reopened: false };
    }

    const [reopened] = await tx
      .update(agentOperationalEscalations)
      .set({
        status: 'open',
        reason: input.reason,
        severity: input.severity,
        metadata: input.metadata ?? {},
        resolvedAt: null,
        resolvedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        dismissReason: null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        updatedAt: now,
      })
      .where(eq(agentOperationalEscalations.id, existing.id))
      .returning();

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agents.escalation.created',
      entityType: 'agent_operational_escalation',
      entityId: String(reopened!.id),
      metadata: { responsibilityId: input.responsibilityId, severity: input.severity, reopened: true },
    });

    return { escalation: reopened!, created: false, reopened: true };
  });
}

export async function acknowledgeEscalation(escalation: EscalationRow, userId: number): Promise<EscalationRow> {
  assertTransition(escalation.status as EscalationStatus, 'acknowledged');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalEscalations)
    .set({ status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: userId, updatedAt: now })
    .where(eq(agentOperationalEscalations.id, escalation.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.escalation.acknowledged',
    entityType: 'agent_operational_escalation',
    entityId: String(escalation.id),
    metadata: { previousStatus: escalation.status },
  });

  return updated!;
}

export async function resolveEscalation(escalation: EscalationRow, userId: number): Promise<EscalationRow> {
  assertTransition(escalation.status as EscalationStatus, 'resolved');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalEscalations)
    .set({ status: 'resolved', resolvedAt: now, resolvedBy: userId, updatedAt: now })
    .where(eq(agentOperationalEscalations.id, escalation.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.escalation.resolved',
    entityType: 'agent_operational_escalation',
    entityId: String(escalation.id),
    metadata: { previousStatus: escalation.status },
  });

  return updated!;
}

export async function dismissEscalation(escalation: EscalationRow, reason: string, userId: number): Promise<EscalationRow> {
  assertTransition(escalation.status as EscalationStatus, 'dismissed');

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalEscalations)
    .set({ status: 'dismissed', dismissedAt: now, dismissedBy: userId, dismissReason: reason, updatedAt: now })
    .where(eq(agentOperationalEscalations.id, escalation.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.escalation.dismissed',
    entityType: 'agent_operational_escalation',
    entityId: String(escalation.id),
    metadata: { previousStatus: escalation.status, reason },
  });

  return updated!;
}

export async function getEscalationById(id: number): Promise<EscalationRow | null> {
  const [row] = await db.select().from(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, id)).limit(1);
  return row ?? null;
}

export interface ListEscalationsParams {
  page: number;
  limit: number;
  status?: EscalationStatus;
  severity?: EscalationSeverity;
  responsibilityId?: number;
  targetAgentId?: number;
  targetUserId?: number;
}

export async function listEscalations(params: ListEscalationsParams) {
  const conditions: SQL[] = [];
  if (params.status) conditions.push(eq(agentOperationalEscalations.status, params.status));
  if (params.severity) conditions.push(eq(agentOperationalEscalations.severity, params.severity));
  if (params.responsibilityId) conditions.push(eq(agentOperationalEscalations.responsibilityId, params.responsibilityId));
  if (params.targetAgentId) conditions.push(eq(agentOperationalEscalations.targetAgentId, params.targetAgentId));
  if (params.targetUserId) conditions.push(eq(agentOperationalEscalations.targetUserId, params.targetUserId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentOperationalEscalations)
      .where(where)
      .orderBy(desc(agentOperationalEscalations.createdAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentOperationalEscalations).where(where),
  ]);

  return { rows, total: Number(total) };
}
