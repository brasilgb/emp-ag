import type { OperationalIncident, OperationalIncidentType, OperationalSeverity, OperationalSignal, OperationalSignalType } from './health-types.js';

const SEVERITY_RANK: Record<OperationalSeverity, number> = { info: 0, warning: 1, critical: 2 };

/**
 * Agentes v2.5 (correio.md seção 13) — classifica sinais em incidentes,
 * SEM machine learning, SEM LLM (seção 13: "não implementar machine
 * learning", "não utilizar LLM para correlation"). Correlação
 * determinística por `incidentType + entityType + entityId` — múltiplos
 * sinais do MESMO tipo para a MESMA entidade viram UM incidente (nunca
 * três incidentes independentes para o mesmo Job falhando três vezes).
 *
 * Mapeamento signal type → incident type (seção 6, documentado em
 * código — nunca inferido pelo nome sozinho):
 * - `workflow_stale` → `recovery_required` (é isso que o torna acionável: precisa de safe_recovery)
 * - `manual_attention_pending` → `manual_attention_required` (já está na Decision Queue — ver response-policy.ts: `already_handled`)
 * - `autonomy_disabled_globally` → `operational_degradation` (degradação de escopo global, não específica de uma entidade)
 * - demais tipos (job_repeated_failure, run_stuck, delivery_failure, autonomy_circuit_open, approval_bottleneck) mantêm o MESMO nome como incident type.
 */
const SIGNAL_TO_INCIDENT_TYPE: Record<OperationalSignalType, OperationalIncidentType> = {
  workflow_stale: 'recovery_required',
  job_repeated_failure: 'repeated_job_failure',
  run_stuck: 'run_stuck',
  delivery_failure: 'delivery_failure',
  autonomy_circuit_open: 'autonomy_circuit_open',
  approval_bottleneck: 'approval_bottleneck',
  manual_attention_pending: 'manual_attention_required',
  autonomy_disabled_globally: 'operational_degradation',
};

export function classifyIncidents(signals: OperationalSignal[]): OperationalIncident[] {
  const groups = new Map<string, { type: OperationalIncidentType; entityType: string; entityId: string; signals: OperationalSignal[] }>();

  for (const signal of signals) {
    const incidentType = SIGNAL_TO_INCIDENT_TYPE[signal.type];
    const entityType = signal.entityType ?? incidentType;
    const entityId = signal.entityId ?? 'global';
    const key = `${incidentType}:${entityType}:${entityId}`;

    const existing = groups.get(key);
    if (existing) {
      existing.signals.push(signal);
    } else {
      groups.set(key, { type: incidentType, entityType, entityId, signals: [signal] });
    }
  }

  const incidents: OperationalIncident[] = [];

  for (const [id, group] of groups) {
    const severity = group.signals.reduce<OperationalSeverity>(
      (max, signal) => (SEVERITY_RANK[signal.severity] > SEVERITY_RANK[max] ? signal.severity : max),
      'info',
    );

    const mostRecent = group.signals.reduce((latest, signal) => (signal.detectedAt > latest.detectedAt ? signal : latest), group.signals[0]!);

    incidents.push({
      id,
      type: group.type,
      severity,
      entityType: group.entityType,
      entityId: group.entityId,
      problem: mostRecent.reason,
      detectedAt: mostRecent.detectedAt,
      signals: group.signals,
    });
  }

  return incidents.sort((a, b) => (b.detectedAt > a.detectedAt ? 1 : -1));
}
