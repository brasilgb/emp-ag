import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentActionPlanItems, agentDirectorDecisions, users } from '../../../db/schema/index.js';
import { AgentError } from '../../errors.js';
import { executeActionPlan } from '../../executor/action-plan-executor.js';
import { planEvaluateAndPersistActionPlan } from '../../orchestration/create-action-plan.js';
import { audit } from '../../../services/audit.js';
import { buildObjectiveForSignal } from '../workflows/catalog.js';

import type { DecisionRow } from './queue-service.js';

/**
 * Agentes v1.9 (correio.md seção 16) — "alguém viu e assumiu ciência",
 * nada mais. Só a partir de 'open' (correio.md seção 5: "validar
 * origem; validar status atual"). Recebe o `DecisionRow` já carregado
 * pela rota (que também resolve o 404) — nunca reconsulta.
 */
export async function acknowledgeDecision(decision: DecisionRow, userId: number): Promise<DecisionRow> {
  if (decision.status !== 'open') {
    throw new AgentError('conflict', `Decision Item está "${decision.status}" — só pode ser reconhecido a partir de "open".`);
  }

  const now = new Date();
  const [updated] = await db
    .update(agentDirectorDecisions)
    .set({ status: 'acknowledged', acknowledgedAt: now, acknowledgedBy: userId, updatedAt: now })
    .where(eq(agentDirectorDecisions.id, decision.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.director.decision.acknowledged',
    entityType: 'agent_director_decision',
    entityId: String(decision.id),
    metadata: { signalType: decision.signalType, domain: decision.domain, previousStatus: decision.status },
  });

  return updated;
}

/**
 * Agentes v1.9 (correio.md seção 15) — "responsável operacional pelo
 * acompanhamento", nunca autorização para executar ferramentas. Permite
 * de qualquer estado não-terminal.
 */
export async function assignDecision(decision: DecisionRow, assigneeUserId: number, actorUserId: number): Promise<DecisionRow> {
  if (decision.status === 'resolved' || decision.status === 'dismissed') {
    throw new AgentError('conflict', `Decision Item está "${decision.status}" — não pode ser atribuído.`);
  }

  const [assignee] = await db.select({ id: users.id }).from(users).where(eq(users.id, assigneeUserId)).limit(1);
  if (!assignee) {
    throw new AgentError('validation_error', 'Usuário atribuído não existe.');
  }

  const now = new Date();
  const [updated] = await db
    .update(agentDirectorDecisions)
    .set({ assignedUserId: assigneeUserId, updatedAt: now })
    .where(eq(agentDirectorDecisions.id, decision.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.decision.assigned',
    entityType: 'agent_director_decision',
    entityId: String(decision.id),
    metadata: {
      signalType: decision.signalType,
      domain: decision.domain,
      assignedUserId: assigneeUserId,
      previousAssignedUserId: decision.assignedUserId,
    },
  });

  return updated;
}

/**
 * Agentes v1.9 (correio.md seção 17) — soft state, nunca apaga. Reason
 * obrigatório. Reabertura por reocorrência é tratada em
 * sync-service.ts, não aqui.
 */
export async function dismissDecision(decision: DecisionRow, reason: string, userId: number): Promise<DecisionRow> {
  if (decision.status === 'resolved' || decision.status === 'dismissed') {
    throw new AgentError('conflict', `Decision Item já está "${decision.status}".`);
  }

  const now = new Date();
  const [updated] = await db
    .update(agentDirectorDecisions)
    .set({ status: 'dismissed', dismissedAt: now, dismissedBy: userId, dismissReason: reason, updatedAt: now })
    .where(eq(agentDirectorDecisions.id, decision.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.director.decision.dismissed',
    entityType: 'agent_director_decision',
    entityId: String(decision.id),
    metadata: { signalType: decision.signalType, domain: decision.domain, reason, previousStatus: decision.status },
  });

  return updated;
}

/**
 * Agentes v1.9 (correio.md seção 13) — reutiliza EXATAMENTE o pipeline
 * da v1.8 (planEvaluateAndPersistActionPlan + executeActionPlan), a
 * mesma dupla de funções de POST /agents/action-plans e de
 * POST /agents/director/signals/:id/propose. `POST
 * /director/signals/:id/propose` (v1.8) continua existindo e funcionando
 * sem nenhuma mudança — compatibilidade total (correio.md seção 13:
 * "compatibilidade é prioritária").
 */
export async function proposeActionForDecision(decision: DecisionRow, userId: number) {
  if (decision.status !== 'open' && decision.status !== 'acknowledged') {
    throw new AgentError(
      'conflict',
      `Decision Item está "${decision.status}" — só é possível propor ação a partir de "open" ou "acknowledged" (já existe um Action Plan em ${decision.actionPlanId ? `#${decision.actionPlanId}` : 'andamento'}).`,
    );
  }

  const objective = buildObjectiveForSignal({
    id: decision.deduplicationKey,
    type: decision.signalType,
    domain: decision.domain as 'crm' | 'projects' | 'finance' | 'support' | 'agents',
    severity: decision.severity as 'info' | 'attention' | 'warning' | 'critical',
    title: decision.title,
    description: decision.description,
    entityType: decision.entityType ?? undefined,
    entityId: decision.entityId ?? undefined,
    detectedAt: decision.firstDetectedAt,
    metadata: decision.metadata as Record<string, unknown>,
  });

  if (!objective) {
    throw new AgentError('validation_error', `Domínio "${decision.domain}" não tem workflow de proposta de ação.`);
  }

  const created = await planEvaluateAndPersistActionPlan({ requestedBy: userId, objective });

  if (!created.ok) {
    throw new AgentError(created.code, created.message, 'details' in created ? created.details : undefined);
  }

  const finalPlan = await executeActionPlan(created.plan.id, userId);
  const finalItems = await db
    .select()
    .from(agentActionPlanItems)
    .where(eq(agentActionPlanItems.planId, created.plan.id))
    .orderBy(agentActionPlanItems.sequence);

  const hasApprovalRequired = finalItems.some((item) => item.decision === 'approval_required');
  const nextStatus = hasApprovalRequired ? 'awaiting_approval' : 'action_planned';

  const now = new Date();
  const [updatedDecision] = await db
    .update(agentDirectorDecisions)
    .set({
      status: nextStatus,
      actionPlanId: finalPlan.id,
      requiresHumanAttention: hasApprovalRequired || decision.requiresHumanAttention,
      updatedAt: now,
    })
    .where(eq(agentDirectorDecisions.id, decision.id))
    .returning();

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.director.decision.action_proposed',
    entityType: 'agent_director_decision',
    entityId: String(decision.id),
    metadata: {
      signalType: decision.signalType,
      domain: decision.domain,
      resultingActionPlanId: finalPlan.id,
      nextStatus,
    },
  });

  return { decision: updatedDecision, plan: finalPlan, items: finalItems };
}
