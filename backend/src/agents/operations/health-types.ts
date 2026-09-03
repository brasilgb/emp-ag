/**
 * Agentes v2.5 (correio.md seções 4/5/6/7/8) — vocabulário fechado do
 * Operational Supervisor. Mesmo estilo de `recovery/types.ts` (arrays
 * `as const` + tipo derivado). Nenhum destes tipos é decidido por LLM —
 * o supervisor inteiro é determinístico (seção 2/34: "Response Policy
 * não depender de LLM").
 */
export const OPERATIONAL_SIGNAL_TYPES = [
  'workflow_stale',
  'job_repeated_failure',
  'run_stuck',
  'delivery_failure',
  'autonomy_circuit_open',
  'approval_bottleneck',
  'manual_attention_pending',
  'autonomy_disabled_globally',
] as const;
export type OperationalSignalType = (typeof OPERATIONAL_SIGNAL_TYPES)[number];

export const OPERATIONAL_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type OperationalSeverity = (typeof OPERATIONAL_SEVERITIES)[number];

export interface OperationalSignal {
  type: OperationalSignalType;
  severity: OperationalSeverity;
  source: string;
  entityType?: string;
  entityId?: string;
  detectedAt: string;
  reason: string;
  // Seção 5: "nunca incluir secrets/tokens/credentials/payloads
  // sensíveis/stack traces completos" — cada coletor (signals.ts) monta
  // este objeto manualmente com campos já seguros, nunca repassa um
  // erro bruto do banco/provider.
  metadata?: Record<string, string | number | boolean | null>;
}

// Seção 6 — os 9 tipos sugeridos, todos com pelo menos um detector real
// nesta versão (ver signals.ts/incidents.ts para o mapeamento
// signal→incident exato, documentado em código).
export const OPERATIONAL_INCIDENT_TYPES = [
  'recovery_required',
  'repeated_job_failure',
  'run_stuck',
  'delivery_failure',
  'manual_attention_required',
  'autonomy_circuit_open',
  'approval_bottleneck',
  'operational_degradation',
] as const;
export type OperationalIncidentType = (typeof OPERATIONAL_INCIDENT_TYPES)[number];

export interface OperationalIncident {
  // Identidade determinística (seção 13): `${incidentType}:${entityType}:${entityId}`
  // — nunca um id sintético aleatório, garante correlação/deduplicação
  // estável entre scans.
  id: string;
  type: OperationalIncidentType;
  severity: OperationalSeverity;
  entityType: string;
  entityId: string;
  problem: string;
  detectedAt: string;
  signals: OperationalSignal[];
}

// Seção 8 — vocabulário fechado da decisão. `already_handled` (seção 8:
// "se houver necessidade real, pode existir") é usado quando o mecanismo
// oficial já tratou a condição sozinho (ex.: Circuit Breaker já abriu —
// autonomia já está restrita, nenhuma ação nova é necessária).
export const OPERATIONAL_RESPONSES = ['observe', 'safe_recovery', 'restrict_autonomy', 'manual_attention', 'already_handled'] as const;
export type OperationalResponse = (typeof OPERATIONAL_RESPONSES)[number];

export interface OperationalRecommendation {
  incidentId: string;
  incidentType: OperationalIncidentType;
  response: OperationalResponse;
  reason: string;
}

export const OPERATIONAL_HEALTH_STATUSES = ['healthy', 'degraded', 'attention_required', 'restricted'] as const;
export type OperationalHealthStatus = (typeof OPERATIONAL_HEALTH_STATUSES)[number];

export interface OperationalHealth {
  status: OperationalHealthStatus;
  generatedAt: string;
  summary: {
    activeIncidents: number;
    criticalIncidents: number;
    manualAttentionPending: number;
    staleWorkflows: number;
    failingJobs: number;
    failingDeliveries: number;
  };
  signals: OperationalSignal[];
  incidents: OperationalIncident[];
  recommendations: OperationalRecommendation[];
}

/** Resultado de UMA tentativa de resposta aplicada (ou que SERIA aplicada, em dry-run) a um incidente. */
export interface OperationalIncidentResult {
  incidentId: string;
  incidentType: OperationalIncidentType;
  entityType: string;
  entityId: string;
  response: OperationalResponse;
  // Em dry-run, prefixado `would_` (seção 16) — nunca o mesmo valor de
  // uma execução real, para nunca ser confundido com efeito de verdade.
  outcome: 'observed' | 'recovered' | 'autonomy_restricted' | 'escalated' | 'already_handled' | 'would_observe' | 'would_recover' | 'would_restrict_autonomy' | 'would_escalate' | 'skipped';
  reason: string;
  timestamp: string;
}

export interface OperationalSupervisionReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  signalsDetected: number;
  incidentsDetected: number;
  observed: number;
  recovered: number;
  autonomyRestricted: number;
  escalated: number;
  results: OperationalIncidentResult[];
}
