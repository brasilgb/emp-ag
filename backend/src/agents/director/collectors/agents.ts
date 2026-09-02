import { desc, eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentApprovals, agentJobs } from '../../../db/schema/index.js';
import { listIncidents } from '../../incidents/service.js';

import type { OperationalSignal } from '../types.js';

const INCIDENT_SEVERITY: Record<string, OperationalSignal['severity']> = {
  autonomy_circuit_open: 'critical',
  autonomous_cycle_detected: 'critical',
  autonomy_depth_exceeded: 'warning',
  autonomy_chain_budget_exceeded: 'warning',
  autonomous_rate_limit_exceeded: 'warning',
  job_repeated_failure: 'warning',
  event_delivery_failed: 'attention',
};

/**
 * Agentes v1.8 (correio.md secao 6) — dominio 'agents' do briefing:
 * saude da propria infraestrutura de agentes (nao um modulo de negocio).
 * Reaproveita `listIncidents()` da v1.6 (nenhuma query nova para
 * circuit breakers/ciclos/budget/rate limit/falhas repetidas/deliveries
 * falhas) e consulta `agent_approvals`/`agent_jobs` diretamente — este
 * collector vive dentro do proprio modulo de agentes (nao cruza para um
 * modulo de negocio), entao nao se aplica a restricao de "nunca SQL
 * dentro do Diretor" (essa regra e sobre nao duplicar logica de
 * dominio de CRM/Projetos/Financeiro/Suporte).
 */
export async function collectAgentsSignals(now: Date): Promise<OperationalSignal[]> {
  const signals: OperationalSignal[] = [];

  const { data: incidents } = await listIncidents({ page: 1, limit: 20 });

  for (const incident of incidents) {
    signals.push({
      id: `agents.incident:${incident.id}`,
      type: `agents.incident.${incident.type}`,
      domain: 'agents',
      severity: INCIDENT_SEVERITY[incident.type] ?? 'warning',
      title: incident.summary,
      description: incident.summary,
      entityType: 'agent_job',
      entityId: incident.jobId ?? undefined,
      detectedAt: now,
      metadata: { incidentId: incident.id, incidentType: incident.type, ...incident.details },
    });
  }

  const openCircuitJobs = await db
    .select({ id: agentJobs.id, name: agentJobs.name })
    .from(agentJobs)
    .where(eq(agentJobs.circuitState, 'open'));

  for (const job of openCircuitJobs) {
    signals.push({
      id: `agents.job_circuit_open:${job.id}`,
      type: 'agents.job_circuit_open',
      domain: 'agents',
      severity: 'critical',
      title: `Circuit breaker aberto: ${job.name}`,
      description: `O Job "${job.name}" está com o circuit breaker aberto — execuções autônomas bloqueadas até o cooldown.`,
      entityType: 'agent_job',
      entityId: job.id,
      detectedAt: now,
      metadata: {},
    });
  }

  const pendingApprovals = await db
    .select({ id: agentApprovals.id, reason: agentApprovals.reason, createdAt: agentApprovals.createdAt })
    .from(agentApprovals)
    .where(eq(agentApprovals.status, 'pending'))
    .orderBy(desc(agentApprovals.createdAt))
    .limit(20);

  for (const approval of pendingApprovals) {
    signals.push({
      id: `agents.approval_pending:${approval.id}`,
      type: 'agents.approval_pending',
      domain: 'agents',
      severity: 'attention',
      title: `Approval pendente #${approval.id}`,
      description: approval.reason ?? 'Ação de agente aguardando aprovação.',
      entityType: 'agent_approval',
      entityId: approval.id,
      detectedAt: now,
      metadata: { createdAt: approval.createdAt },
    });
  }

  return signals;
}
