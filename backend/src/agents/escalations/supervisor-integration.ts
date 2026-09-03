import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentDirectorInitiatives, agentExecutiveReviews, agentJobRuns, agentJobs, agentStrategicMemories, agents } from '../../db/schema/index.js';
import type { OperationalIncident } from '../operations/health-types.js';
import { resolvePrimaryResponsibility } from '../responsibilities/ownership.js';
import type { ResponsibilityRow } from '../responsibilities/service.js';

import { audit } from '../../services/audit.js';
import { createOrReopenFollowUpFromEscalation } from '../followups/service.js';

import { createOrReopenEscalation } from './service.js';
import type { EscalationRow } from './service.js';
import type { EscalationSeverity } from './types.js';

/**
 * Agentes v2.6 (correio.md seção 13) — "identifique quais findings reais
 * do supervisor podem ser associados de maneira DETERMINÍSTICA a um
 * domínio... se associação não for inequívoca, não atribuir
 * automaticamente." Mapeamento avaliado incidente a incidente, código
 * real revisado antes de decidir (nunca adivinhado pelo nome):
 *
 * - `recovery_required` (entityType `initiative`/`executive_review`/
 *   `strategic_memory`): domínio real e inequívoco — `agent_director_initiatives.domain`
 *   (direto, ou via `agent_executive_reviews.initiative_id` quando o
 *   incidente é sobre a review) ou `agent_strategic_memories.domain`
 *   (coluna própria).
 * - `repeated_job_failure`/`run_stuck`/`autonomy_circuit_open`
 *   (entityType `agent_job`/`agent_job_run`): resolvido via
 *   `agent_jobs.agent_id → agents.department`, mapeado para
 *   `SignalDomain` pela MESMA convenção já documentada em
 *   `director/types.ts` ("sinais de Customer Success entram como
 *   domain='support'") — nunca uma convenção nova inventada aqui.
 * - `delivery_failure`/`approval_bottleneck`/`manual_attention_required`/
 *   `operational_degradation`: SEM associação automática nesta versão —
 *   nenhuma dessas entidades carrega um domínio de negócio inequívoco no
 *   schema real (Event Rules podem cruzar domínios; approvals/decisões
 *   agregadas não têm uma única entidade de origem) — `null`, deixado
 *   para tratamento humano/manual (nunca "adivinhado").
 */
const DEPARTMENT_TO_DOMAIN: Record<string, string> = {
  director: 'agents',
  sales: 'crm',
  projects: 'projects',
  finance: 'finance',
  support: 'support',
  customer_success: 'support',
};

async function resolveDomainForJob(jobId: number): Promise<string | null> {
  const [job] = await db.select({ agentId: agentJobs.agentId }).from(agentJobs).where(eq(agentJobs.id, jobId)).limit(1);
  if (!job) return null;

  const [agent] = await db.select({ department: agents.department }).from(agents).where(eq(agents.id, job.agentId)).limit(1);
  if (!agent) return null;

  return DEPARTMENT_TO_DOMAIN[agent.department] ?? null;
}

export async function resolveIncidentDomain(incident: OperationalIncident): Promise<string | null> {
  const entityId = Number(incident.entityId);
  if (!Number.isFinite(entityId)) return null;

  switch (incident.entityType) {
    case 'initiative': {
      const [row] = await db.select({ domain: agentDirectorInitiatives.domain }).from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, entityId)).limit(1);
      return row?.domain ?? null;
    }
    case 'executive_review': {
      const [review] = await db.select({ initiativeId: agentExecutiveReviews.initiativeId }).from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, entityId)).limit(1);
      if (!review) return null;
      const [initiative] = await db.select({ domain: agentDirectorInitiatives.domain }).from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, review.initiativeId)).limit(1);
      return initiative?.domain ?? null;
    }
    case 'strategic_memory': {
      const [row] = await db.select({ domain: agentStrategicMemories.domain }).from(agentStrategicMemories).where(eq(agentStrategicMemories.id, entityId)).limit(1);
      return row?.domain ?? null;
    }
    case 'agent_job':
      return resolveDomainForJob(entityId);
    case 'agent_job_run': {
      const [run] = await db.select({ jobId: agentJobRuns.jobId }).from(agentJobRuns).where(eq(agentJobRuns.id, entityId)).limit(1);
      if (!run) return null;
      return resolveDomainForJob(run.jobId);
    }
    default:
      // delivery_failure / approval_bottleneck / manual_attention_required /
      // operational_degradation — deliberadamente sem associação
      // automática nesta versão (ver docblock acima).
      return null;
  }
}

function severityFromIncident(severity: OperationalIncident['severity']): EscalationSeverity {
  return severity;
}

export interface SupervisorEscalationOutcome {
  escalation: EscalationRow;
  responsibility: ResponsibilityRow;
  created: boolean;
  reopened: boolean;
}

/**
 * Agentes v2.6 (correio.md seções 13/14) — ponto único de integração
 * entre um `OperationalIncident` (v2.5) e a camada de Responsibility/
 * Escalation (v2.6). Retorna `null` sempre que a associação não é
 * inequívoca (seção 13) OU quando a Responsibility encontrada tem
 * `escalationPolicy='none'` (dono configurado explicitamente para NUNCA
 * escalar automaticamente — respeitado).
 *
 * `agent_then_human` nesta versão (seção 32: "não implementar... multi-stage
 * escalation engine") significa "ambos os alvos populados na MESMA
 * escalation" — nunca um estágio temporal automático (isso seria
 * exatamente o engine multi-estágio proibido).
 */
export async function escalateSupervisorFinding(incident: OperationalIncident): Promise<SupervisorEscalationOutcome | null> {
  const domain = await resolveIncidentDomain(incident);
  if (!domain) return null;

  const responsibility = await resolvePrimaryResponsibility({ domain });
  if (!responsibility) return null;
  if (responsibility.escalationPolicy === 'none') return null;

  const targetAgentId = responsibility.escalationPolicy === 'agent' || responsibility.escalationPolicy === 'agent_then_human' ? responsibility.escalationTargetAgentId : null;
  const targetUserId = responsibility.escalationPolicy === 'human' || responsibility.escalationPolicy === 'agent_then_human' ? responsibility.escalationTargetUserId : null;

  const dedupKey = `${responsibility.id}:${incident.type}:${incident.entityType}:${incident.entityId}`;

  const { escalation, created, reopened } = await createOrReopenEscalation({
    responsibilityId: responsibility.id,
    sourceAgentId: responsibility.agentId,
    targetAgentId,
    targetUserId,
    reason: incident.problem,
    severity: severityFromIncident(incident.severity),
    entityType: incident.entityType,
    entityId: Number(incident.entityId),
    dedupKey,
    metadata: { incidentType: incident.type, incidentId: incident.id },
  });

  // Agentes v2.7 (correio.md seção 7) — "ao criar/reabrir uma
  // OperationalEscalation aplicável, avaliar a criação/reabertura de um
  // FollowUp." Só quando a escalation É de fato nova/reaberta (nunca no
  // no-op de uma escalation já ativa — evita reprocessamento redundante
  // do FollowUp para a mesma condição). SEMPRE best-effort e com seu
  // próprio try/catch — uma falha aqui nunca deve derrubar o fluxo de
  // Escalation já testado e estável da v2.6 (mesmo racional do
  // try/catch em supervisor-service.ts para a própria criação da
  // escalation).
  if (created || reopened) {
    try {
      await createOrReopenFollowUpFromEscalation({ escalation, responsibility });
    } catch (error) {
      await audit({
        userId: null,
        actorType: 'system',
        actorId: null,
        action: 'agents.followup.creation_failed',
        entityType: 'agent_operational_escalation',
        entityId: String(escalation.id),
        metadata: { message: error instanceof Error ? error.message : 'Falha desconhecida ao criar FollowUp.' },
      });
    }
  }

  return { escalation, responsibility, created, reopened };
}
