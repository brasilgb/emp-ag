import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentDirectorDecisions, agentJobs } from '../../db/schema/index.js';

import { classifyIncidents } from './incidents.js';
import { evaluateResponsePolicy } from './response-policy.js';
import { collectOperationalSignals } from './signals.js';
import type { OperationalHealth, OperationalHealthStatus, OperationalIncident, OperationalRecommendation } from './health-types.js';

/**
 * Agentes v2.5 — monta as recomendações para um conjunto de incidentes já
 * classificados, resolvendo o único contexto externo necessário
 * (autonomia atual do Job, para `repeated_job_failure`) com UMA query em
 * lote. Reaproveitado por `getOperationalHealth` (só leitura) e por
 * `supervisor-service.ts:runOperationalSupervision` (que também aplica
 * as respostas) — nunca duas implementações divergentes da mesma
 * decisão.
 */
export async function buildRecommendations(incidents: OperationalIncident[]): Promise<OperationalRecommendation[]> {
  const jobEntityIds = incidents.filter((incident) => incident.type === 'repeated_job_failure').map((incident) => Number(incident.entityId));
  const jobRows = jobEntityIds.length > 0 ? await db.select({ id: agentJobs.id, autonomyEnabled: agentJobs.autonomyEnabled }).from(agentJobs).where(inArray(agentJobs.id, jobEntityIds)) : [];
  const autonomyEnabledByJobId = new Map(jobRows.map((row) => [row.id, row.autonomyEnabled]));

  return incidents.map((incident) => {
    const context = incident.type === 'repeated_job_failure' ? { jobAutonomyEnabled: autonomyEnabledByJobId.get(Number(incident.entityId)) } : {};
    const decision = evaluateResponsePolicy(incident, context);
    return { incidentId: incident.id, incidentType: incident.type, response: decision.response, reason: decision.reason };
  });
}

/**
 * Agentes v2.5 (correio.md seção 4) — snapshot estruturado, calculado
 * sob demanda a cada chamada (nenhum snapshot persistido "por
 * conveniência" — seção 4). Nenhuma mutação — `collectOperationalSignals`
 * é leitura pura, `classifyIncidents`/`evaluateResponsePolicy` são
 * funções puras em memória.
 */
export async function getOperationalHealth(now: Date = new Date()): Promise<OperationalHealth> {
  const signals = await collectOperationalSignals(now);
  const incidents = classifyIncidents(signals);
  const recommendations = await buildRecommendations(incidents);

  const [restrictedJobsRow] = await db.select({ total: count() }).from(agentJobs).where(eq(agentJobs.autonomyEnabled, false));
  const [manualAttentionRow] = await db
    .select({ total: count() })
    .from(agentDirectorDecisions)
    .where(and(eq(agentDirectorDecisions.domain, 'agents'), eq(agentDirectorDecisions.requiresHumanAttention, true), eq(agentDirectorDecisions.status, 'open')));

  const status = deriveOverallStatus(incidents, Number(restrictedJobsRow?.total ?? 0));

  const summary = {
    activeIncidents: incidents.length,
    criticalIncidents: incidents.filter((incident) => incident.severity === 'critical').length,
    manualAttentionPending: Number(manualAttentionRow?.total ?? 0),
    staleWorkflows: incidents.filter((incident) => incident.type === 'recovery_required').length,
    failingJobs: incidents.filter((incident) => incident.type === 'repeated_job_failure').length,
    failingDeliveries: incidents.filter((incident) => incident.type === 'delivery_failure').length,
  };

  return { status, generatedAt: now.toISOString(), summary, signals, incidents, recommendations };
}

/**
 * Prioridade determinística (nunca ambígua): `restricted` > `attention_required`
 * > `degraded` > `healthy`. `restricted` reflete um FATO real atual
 * (existe autonomia restrita agora — por Circuit Breaker, kill switch
 * global, ou Job desabilitado), nunca uma previsão do que o scan atual
 * VAI fazer.
 */
function deriveOverallStatus(incidents: OperationalIncident[], restrictedJobsCount: number): OperationalHealthStatus {
  const hasOpenCircuit = incidents.some((incident) => incident.type === 'autonomy_circuit_open');
  const hasGlobalDegradation = incidents.some((incident) => incident.type === 'operational_degradation');

  if (hasOpenCircuit || hasGlobalDegradation || restrictedJobsCount > 0) return 'restricted';

  const hasCritical = incidents.some((incident) => incident.severity === 'critical');
  const hasManualAttention = incidents.some((incident) => incident.type === 'manual_attention_required');
  if (hasCritical || hasManualAttention) return 'attention_required';

  if (incidents.length > 0) return 'degraded';

  return 'healthy';
}
