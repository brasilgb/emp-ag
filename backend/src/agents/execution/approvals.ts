import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentApprovals, agentExecutions, agentTools, agents } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { runHandlerAndLog } from './pipeline.js';
import type { ExecuteToolOutcome } from './pipeline.js';

export type ApprovalDecisionOutcome =
  | { ok: true; execution: ExecuteToolOutcome | null; approvalId: number }
  | { ok: false; code: 'not_found' | 'conflict'; message: string };

/**
 * Aprovação exatamente uma vez (seção 13, teste #10): SELECT ... FOR
 * UPDATE em agent_approvals + agent_executions dentro de uma transação,
 * checando o status antes de transicionar. Uma segunda chamada
 * concorrente vê o status já mudado (a primeira transação já commitou) e
 * retorna conflito sem nunca chamar o handler. O handler roda depois do
 * commit da transação de CAS, reaproveitando runHandlerAndLog — a mesma
 * função usada pela execução direta.
 */
export async function approveExecution(
  approvalId: number,
  approverUserId: number,
  note?: string,
): Promise<ApprovalDecisionOutcome> {
  const cas = await casTransition(approvalId, 'approved', approverUserId, note);

  if (!cas.ok) {
    return cas;
  }

  await audit({
    userId: approverUserId,
    actorType: 'user',
    actorId: String(approverUserId),
    action: 'agent.approval.approved',
    entityType: 'agent_approval',
    entityId: String(approvalId),
    metadata: { executionId: cas.execution.id },
  });

  const [agent] = await db.select().from(agents).where(eq(agents.id, cas.execution.agentId)).limit(1);
  const [tool] = await db.select().from(agentTools).where(eq(agentTools.id, cas.execution.toolId)).limit(1);

  if (!agent || !tool) {
    return { ok: false, code: 'not_found', message: 'Agente ou ferramenta não encontrados.' };
  }

  const outcome = await runHandlerAndLog(
    cas.execution,
    agent,
    tool,
    cas.execution.input,
    cas.execution.userId ?? approverUserId,
  );

  return { ok: true, execution: outcome, approvalId };
}

export async function rejectExecution(
  approvalId: number,
  approverUserId: number,
  note?: string,
): Promise<ApprovalDecisionOutcome> {
  const cas = await casTransition(approvalId, 'rejected', approverUserId, note);

  if (!cas.ok) {
    return cas;
  }

  await audit({
    userId: approverUserId,
    actorType: 'user',
    actorId: String(approverUserId),
    action: 'agent.approval.rejected',
    entityType: 'agent_approval',
    entityId: String(approvalId),
    metadata: { executionId: cas.execution.id },
  });

  return { ok: true, execution: null, approvalId };
}

type CasResult =
  | { ok: true; execution: typeof agentExecutions.$inferSelect }
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

    if (approval.status !== 'pending') {
      return {
        ok: false,
        code: 'conflict',
        message: `Esta solicitação já foi ${approval.status === 'approved' ? 'aprovada' : approval.status === 'rejected' ? 'rejeitada' : 'decidida'}.`,
      };
    }

    // Expiração preguiçosa (seção 13): sem varredura por cron nesta v1,
    // então a expiração é resolvida no mesmo SELECT ... FOR UPDATE que já
    // protege a decisão, mantendo o mesmo princípio de "derivar no
    // momento da leitura" usado no resto do código (ex.: withOverdue).
    if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      await tx
        .update(agentApprovals)
        .set({ status: 'expired', decidedAt: new Date() })
        .where(eq(agentApprovals.id, approvalId));

      return { ok: false, code: 'conflict', message: 'Esta solicitação de aprovação expirou.' };
    }

    const [execution] = await tx
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, approval.executionId))
      .for('update');

    if (!execution || execution.status !== 'waiting_approval') {
      return { ok: false, code: 'conflict', message: 'Esta execução não está mais aguardando aprovação.' };
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

    const [updatedExecution] = await tx
      .update(agentExecutions)
      .set({ status: decision === 'approved' ? 'approved' : 'rejected' })
      .where(eq(agentExecutions.id, execution.id))
      .returning();

    return { ok: true, execution: updatedExecution };
  });
}
