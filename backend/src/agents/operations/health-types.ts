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
  // v3.2 (correio.md "Diferenciar dois tipos de falha") — `failed` é uma
  // FALHA INDIVIDUAL isolada (exceção dentro de `applyResponse` para ESTE
  // incidente) — nunca confundir com uma falha ESTRUTURAL do scan
  // inteiro (essa continua propagando como exceção de
  // `runOperationalSupervision`, capturada só em `scheduler.ts`/pelo
  // caller HTTP — não tem outcome, porque o `results[]` nem chega a
  // existir).
  outcome: 'observed' | 'recovered' | 'autonomy_restricted' | 'escalated' | 'already_handled' | 'would_observe' | 'would_recover' | 'would_restrict_autonomy' | 'would_escalate' | 'skipped' | 'failed';
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
  // v3.2 — aditivo (correio.md seção 7: "não quebrar contratos públicos
  // existentes... adicionar informação de maneira aditiva"): quantos
  // incidentes tiveram sua resposta operacional (`applyResponse`)
  // isoladamente capturada como exceção. `0` sempre que não houve
  // nenhuma falha individual — o mesmo scan "totalmente bem-sucedido" de
  // antes continua existindo, só que agora explicitamente distinguível
  // de um scan com falhas parciais.
  failed: number;
  // v3.4 (correio.md "Operational Supervision Observability & Run
  // History", seção 3/9) — aditivo, mesmo padrão de `failed` acima: a
  // única extensão real pedida a `supervisor-service.ts` nesta versão, e
  // só de CONTAGEM em volta de uma chamada já existente
  // (`escalateSupervisorFinding`, v2.6) — nenhuma lógica decisória nova.
  // `escalationsAttempted` conta toda vez que o loop chega a chamar
  // `escalateSupervisorFinding` (sempre 0 em dry-run, que pula essa
  // chamada inteira — seção 15: "um scan não iniciado por lock ocupado
  // não deve produzir um fake report", mesmo racional aqui: dry-run
  // nunca teve efeito colateral, então nunca "tenta" escalar de verdade).
  // `escalationsFailed` conta exceções capturadas pelo try/catch já
  // existente ali. `escalationsSucceeded` é `attempted - failed` — inclui
  // tanto uma Escalation real criada quanto um `null` legítimo (nenhuma
  // Responsibility correspondente, ou `escalationPolicy: 'none'` —
  // decisões válidas de `escalateSupervisorFinding`, nunca uma falha).
  escalationsAttempted: number;
  escalationsSucceeded: number;
  escalationsFailed: number;
  results: OperationalIncidentResult[];
}
