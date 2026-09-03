import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentJobs } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { reconcileOne } from '../recovery/recovery-service.js';
import type { RecoveryItemResult, WorkflowType } from '../recovery/types.js';

/**
 * Agentes v2.5 (correio.md seção 10) — "Safe Recovery significa
 * EXCLUSIVAMENTE chamar mecanismos de recovery já considerados
 * seguros... O Supervisor NÃO deve implementar reconciliação própria."
 * Chamada direta a `reconcileOne` (v2.4) — nenhuma lógica de
 * reconciliação nova, nenhuma tabela tocada diretamente por este módulo.
 */
export async function applySafeRecovery(params: {
  workflowType: WorkflowType;
  entityId: number;
  dryRun: boolean;
  actorUserId: number | null;
}): Promise<RecoveryItemResult | null> {
  return reconcileOne({ workflowType: params.workflowType, entityId: params.entityId, dryRun: params.dryRun, actorUserId: params.actorUserId });
}

export interface RestrictAutonomyResult {
  applied: boolean;
  reason: string;
}

/**
 * Agentes v2.5 (correio.md seção 11) — "reduzir autonomia", NUNCA
 * "aumentar" (garantido estruturalmente: esta função só sabe escrever
 * `false`, nunca `true` — não existe um parâmetro que permita o
 * contrário). Reaproveita EXATAMENTE a mesma coluna/mecanismo do kill
 * switch por Job já existente (`agent_jobs.autonomy_enabled`, mesmo
 * campo alterado por `PATCH /agents/jobs/:id/autonomy`, v1.5) — nenhum
 * segundo kill switch (seção 11: "não criar um segundo kill switch").
 *
 * Predicado condicional (`WHERE id=? AND autonomy_enabled=true`) — nunca
 * um UPDATE incondicional (seção 18): se o Job já está com autonomia
 * restrita (por este supervisor num scan anterior, ou manualmente por um
 * humano), a chamada é um no-op idempotente (`applied: false`), nunca
 * reaplica o efeito nem duplica auditoria.
 */
export async function restrictJobAutonomy(params: { jobId: number; reason: string; dryRun: boolean }): Promise<RestrictAutonomyResult> {
  if (params.dryRun) {
    const [job] = await db.select({ autonomyEnabled: agentJobs.autonomyEnabled }).from(agentJobs).where(eq(agentJobs.id, params.jobId)).limit(1);
    return { applied: Boolean(job?.autonomyEnabled), reason: params.reason };
  }

  const updated = await db
    .update(agentJobs)
    .set({ autonomyEnabled: false, updatedAt: new Date() })
    .where(and(eq(agentJobs.id, params.jobId), eq(agentJobs.autonomyEnabled, true)))
    .returning({ id: agentJobs.id });

  if (updated.length === 0) {
    return { applied: false, reason: 'Job já estava com autonomia restrita — nenhum efeito duplicado.' };
  }

  await audit({
    userId: null,
    actorType: 'system',
    actorId: null,
    action: 'agent_autonomy.job_disabled',
    entityType: 'agent_job',
    entityId: String(params.jobId),
    metadata: { previous: true, next: false, triggeredBy: 'operational_supervisor', reason: params.reason },
  });

  return { applied: true, reason: params.reason };
}
