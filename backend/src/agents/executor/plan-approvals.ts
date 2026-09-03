import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentActionPlanItems, agentApprovals } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { executeActionPlan } from './action-plan-executor.js';
// Agentes v1.3 (correio.md seção 10): após reexecutar o Action Plan pelo
// mecanismo já existente, sincroniza o Run do Job dono do plano, se
// houver — no-op para planos sem Job (v1.2 continua idêntico).
import { syncJobRunStatus } from '../jobs/job-runner.js';
// Agentes v2.8 (correio.md seção 14) chamava `syncActionProposalStatus`
// explicitamente aqui também — removido na v2.9 (correio.md "BLOQUEIO
// 1"): `executeActionPlan`, logo abaixo, agora dispara essa sincronização
// internamente, sempre que recalcula o status do Action Plan (ver
// docblock de `finalizePlanStatus`/`executeActionPlan` em
// `action-plan-executor.ts`) — inclusive para o caso que motivou este
// arquivo a chamá-la (aprovação/rejeição tardia levando um Action Plan
// `waiting_approval` a um estado terminal). Manter uma segunda chamada
// aqui seria exatamente o "espalhar novos syncActionProposalStatus() por
// vários serviços" que o correio.md pede para evitar.

export type PlanApprovalDecisionOutcome =
  | { ok: true; planId: number; itemId: number; approvalId: number }
  | { ok: false; code: 'not_found' | 'conflict'; message: string };

/**
 * Aprovação de item de Action Plan (correio.md v1.2 seção 5/7) — mesmo
 * padrão CAS de agents/execution/approvals.ts (SELECT ... FOR UPDATE em
 * agent_approvals + agent_action_plan_items dentro de uma transação),
 * adaptado para plan_item_id em vez de execution_id. O item aprovado só
 * roda de fato depois do commit, via executeActionPlan (mesmo executor
 * usado na criação do plano) — nunca dentro da transação de CAS.
 */
export async function approvePlanItem(
  approvalId: number,
  approverUserId: number,
  note?: string,
): Promise<PlanApprovalDecisionOutcome> {
  const cas = await casTransition(approvalId, 'approved', approverUserId, note);

  if (!cas.ok) {
    return cas;
  }

  await audit({
    userId: approverUserId,
    actorType: 'user',
    actorId: String(approverUserId),
    action: 'agent.plan.approval.approved',
    entityType: 'agent_approval',
    entityId: String(approvalId),
    metadata: { planItemId: cas.item.id, planId: cas.item.planId },
  });

  // v2.9 — `executeActionPlan` já sincroniza a Operational Action
  // Proposal dona deste plano internamente (ver import acima); não
  // chamar `syncActionProposalStatus` de novo aqui.
  await executeActionPlan(cas.item.planId, approverUserId);
  await syncJobRunStatus(cas.item.planId, approverUserId);

  return { ok: true, planId: cas.item.planId, itemId: cas.item.id, approvalId };
}

export async function rejectPlanItem(
  approvalId: number,
  approverUserId: number,
  note?: string,
): Promise<PlanApprovalDecisionOutcome> {
  const cas = await casTransition(approvalId, 'rejected', approverUserId, note);

  if (!cas.ok) {
    return cas;
  }

  await audit({
    userId: approverUserId,
    actorType: 'user',
    actorId: String(approverUserId),
    action: 'agent.plan.approval.rejected',
    entityType: 'agent_approval',
    entityId: String(approvalId),
    metadata: { planItemId: cas.item.id, planId: cas.item.planId },
  });

  // Recalcula o status agregado do plano (o item já ficou 'rejected' —
  // executeActionPlan também serve para só reagregar, sem rodar nada
  // novo, já que nenhum item está 'pending'/'approved' além deste).
  // v2.9 — `executeActionPlan` já sincroniza a Operational Action
  // Proposal dona deste plano internamente (ver import acima); não
  // chamar `syncActionProposalStatus` de novo aqui.
  await executeActionPlan(cas.item.planId, approverUserId);
  await syncJobRunStatus(cas.item.planId, approverUserId);

  return { ok: true, planId: cas.item.planId, itemId: cas.item.id, approvalId };
}

type CasResult =
  | { ok: true; item: typeof agentActionPlanItems.$inferSelect }
  | { ok: false; code: 'not_found' | 'conflict'; message: string };

async function casTransition(
  approvalId: number,
  decision: 'approved' | 'rejected',
  approverUserId: number,
  note?: string,
): Promise<CasResult> {
  return db.transaction(async (tx) => {
    const [approval] = await tx
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.id, approvalId))
      .for('update');

    if (!approval) {
      return { ok: false, code: 'not_found', message: 'Solicitação de aprovação não encontrada.' };
    }

    if (approval.planItemId === null) {
      return { ok: false, code: 'not_found', message: 'Esta aprovação não é de um item de plano.' };
    }

    if (approval.status !== 'pending') {
      return {
        ok: false,
        code: 'conflict',
        message: `Esta solicitação já foi ${approval.status === 'approved' ? 'aprovada' : approval.status === 'rejected' ? 'rejeitada' : 'decidida'}.`,
      };
    }

    if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      await tx
        .update(agentApprovals)
        .set({ status: 'expired', decidedAt: new Date() })
        .where(eq(agentApprovals.id, approvalId));

      return { ok: false, code: 'conflict', message: 'Esta solicitação de aprovação expirou.' };
    }

    const [item] = await tx
      .select()
      .from(agentActionPlanItems)
      .where(eq(agentActionPlanItems.id, approval.planItemId))
      .for('update');

    if (!item || item.executionStatus !== 'waiting_approval') {
      return { ok: false, code: 'conflict', message: 'Este item não está mais aguardando aprovação.' };
    }

    await tx
      .update(agentApprovals)
      .set({
        status: decision,
        approvedByUserId: approverUserId,
        decidedAt: new Date(),
        decisionPayload: note ? { note } : null,
      })
      .where(eq(agentApprovals.id, approvalId));

    const [updatedItem] = await tx
      .update(agentActionPlanItems)
      .set({ executionStatus: decision === 'approved' ? 'approved' : 'rejected' })
      .where(eq(agentActionPlanItems.id, item.id))
      .returning();

    return { ok: true, item: updatedItem };
  });
}
