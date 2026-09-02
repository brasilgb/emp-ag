import type {
  ActionDecision,
  ActionPlanItemStatus,
  ActionPlanStatus,
  ActionRisk,
  ApprovalStatus,
  AutonomyBlockReason,
  AutonomyLevel,
  ChatResponse,
  CircuitState,
  DecisionImpact,
  DecisionStatus,
  DecisionUrgency,
  EventDeliveryStatus,
  EventStatus,
  ExecutionStatus,
  FilterOperator,
  HumanVerdict,
  IncidentType,
  InterpretationCategory,
  InterpretationErrorType,
  JobRunStatus,
  JobStatus,
  JobTriggerType,
  SettingKey,
  SettingSource,
  SignalDomain,
  SignalSeverity,
} from "@/types/agents";

/**
 * Helpers puros do módulo Agentes (seção 58) — nenhum componente/hook deve
 * duplicar estes rótulos ou essa lógica de derivação. Mesmo padrão de
 * lib/support/derived.ts: funções puras, testadas isoladamente, sem
 * renderização.
 */

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending: "Pendente",
  running: "Em execução",
  waiting_approval: "Aguardando aprovação",
  approved: "Aprovada",
  rejected: "Rejeitada",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export function executionStatusLabel(status: ExecutionStatus): string {
  return EXECUTION_STATUS_LABELS[status] ?? status;
}

export const AUTONOMY_LEVEL_LABELS: Record<AutonomyLevel, string> = {
  read: "Somente leitura",
  prepare: "Preparação",
  execute: "Execução automática",
  approval_required: "Requer aprovação",
};

export function autonomyLevelLabel(level: AutonomyLevel): string {
  return AUTONOMY_LEVEL_LABELS[level] ?? level;
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// approval_required é sempre destacado como o nível mais sensível — nunca
// deve passar despercebido na UI (seção 13).
export function autonomyLevelBadgeVariant(level: AutonomyLevel): BadgeVariant {
  switch (level) {
    case "approval_required":
      return "destructive";
    case "execute":
      return "default";
    case "prepare":
      return "secondary";
    case "read":
    default:
      return "outline";
  }
}

export type DerivedApprovalState =
  | "pending"
  | "expiring_soon"
  | "expired"
  | "approved"
  | "rejected"
  | "cancelled";

const EXPIRING_SOON_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h

/**
 * Estado de aprovação exibido na UI. "expiring_soon"/"expired" são sempre
 * derivados de expires_at no momento da leitura (mesmo princípio de
 * slaState em lib/support/derived.ts) — o backend só persiste os 5 status
 * reais da colun a (seção 12); a UI refina "pending" com uma leitura de
 * proximidade do vencimento.
 */
export function approvalState(
  approval: { status: ApprovalStatus; expiresAt: string | null },
  now: Date = new Date(),
): DerivedApprovalState {
  if (approval.status !== "pending") {
    return approval.status;
  }

  if (!approval.expiresAt) {
    return "pending";
  }

  const expiresAt = new Date(approval.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return "pending";
  }

  const remainingMs = expiresAt.getTime() - now.getTime();

  if (remainingMs < 0) {
    return "expired";
  }

  if (remainingMs <= EXPIRING_SOON_THRESHOLD_MS) {
    return "expiring_soon";
  }

  return "pending";
}

export const APPROVAL_STATE_LABELS: Record<DerivedApprovalState, string> = {
  pending: "Pendente",
  expiring_soon: "Expira em breve",
  expired: "Expirada",
  approved: "Aprovada",
  rejected: "Rejeitada",
  cancelled: "Cancelada",
};

export function approvalStateLabel(state: DerivedApprovalState): string {
  return APPROVAL_STATE_LABELS[state] ?? state;
}

const UNKNOWN_INTENT_FALLBACK = "Não consegui identificar com segurança qual área deve tratar esta solicitação.";

export interface FormattedChatResponse {
  text: string;
  transparency: string | null;
}

/**
 * Seção 34/42: o backend já devolve `message` limpo (só o texto de
 * resposta) e `agent`/`tool` em campos separados — esta função nunca
 * reformula o texto, só decide a legenda discreta de transparência
 * ("Agente Financeiro · Consultou: finance.get_summary") a partir desses
 * campos, e o fallback de intenção desconhecida quando `message` vem
 * vazio. Nunca expõe parâmetros/dados internos da tool, só o handler.
 */
export function formatChatResponse(response: Pick<ChatResponse, "agent" | "tool" | "message">): FormattedChatResponse {
  const text = response.message || UNKNOWN_INTENT_FALLBACK;

  if (!response.agent || !response.tool) {
    return { text, transparency: null };
  }

  return { text, transparency: `${response.agent.name} · Consultou: ${response.tool}` };
}

// Seção 29/30/30-bis — as quatro categorias que importam para quem avalia
// o LLM Interpreter. `deterministic_unknown_llm_recognized`
// (determinístico não reconheceu nada mas o LLM achou uma tool válida)
// nunca deve ser lido como um "erro" de divergência qualquer — é
// justamente o caso mais interessante para validar antes de ativar
// fallback. `both_unknown` (nenhum dos dois reconheceu nada) não é match
// nem mismatch — fica fora do match rate no backend, e também não deve
// ler como "os dois concordaram" (INTERPRETATION_CATEGORY_LABELS abaixo
// nomeia isso explicitamente, para não confundir com `match`).
export const INTERPRETATION_CATEGORY_LABELS: Record<InterpretationCategory, string> = {
  match: "Concordância",
  mismatch: "Divergência",
  deterministic_unknown_llm_recognized: "Determinístico não reconheceu · LLM reconheceu",
  both_unknown: "Nenhum dos dois reconheceu",
};

export function interpretationCategoryLabel(category: InterpretationCategory | null): string {
  if (!category) return "Não comparável";
  return INTERPRETATION_CATEGORY_LABELS[category] ?? category;
}

export const HUMAN_VERDICT_LABELS: Record<HumanVerdict, string> = {
  correct: "Correto",
  incorrect: "Incorreto",
};

export function humanVerdictLabel(verdict: HumanVerdict | null): string | null {
  if (!verdict) return null;
  return HUMAN_VERDICT_LABELS[verdict] ?? verdict;
}

// Seção 30-bis — rótulos curtos da taxonomia de error/classificação.
export const INTERPRETATION_ERROR_TYPE_LABELS: Record<InterpretationErrorType, string> = {
  timeout: "Timeout",
  provider_http_error: "Erro HTTP do provider",
  provider_error: "Falha ao chamar o provider",
  invalid_json: "JSON inválido",
  schema_validation_error: "Saída fora do schema",
  invalid_agent: "Agente inválido",
  invalid_tool: "Tool inválida",
  invalid_arguments: "Argumentos inválidos",
  low_confidence: "Confiança baixa",
  clarification: "Pediu esclarecimento",
};

export function interpretationErrorTypeLabel(type: InterpretationErrorType): string {
  return INTERPRETATION_ERROR_TYPE_LABELS[type] ?? type;
}

// Agentes v1.2 — Action Planning + Approval Workflow (correio.md).
export const ACTION_PLAN_STATUS_LABELS: Record<ActionPlanStatus, string> = {
  draft: "Rascunho",
  evaluating: "Avaliando",
  waiting_approval: "Aguardando aprovação",
  executing: "Executando",
  completed: "Concluído",
  partial: "Parcialmente concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function actionPlanStatusLabel(status: ActionPlanStatus): string {
  return ACTION_PLAN_STATUS_LABELS[status] ?? status;
}

export const ACTION_PLAN_ITEM_STATUS_LABELS: Record<ActionPlanItemStatus, string> = {
  pending: "Pendente",
  waiting_approval: "Aguardando aprovação",
  approved: "Aprovado",
  executing: "Executando",
  completed: "Concluído",
  failed: "Falhou",
  blocked: "Bloqueado",
  rejected: "Rejeitado",
  skipped: "Shadow (não executado)",
};

export function actionPlanItemStatusLabel(status: ActionPlanItemStatus): string {
  return ACTION_PLAN_ITEM_STATUS_LABELS[status] ?? status;
}

export const ACTION_RISK_LABELS: Record<ActionRisk, string> = {
  read: "Leitura",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
};

export function actionRiskLabel(risk: ActionRisk): string {
  return ACTION_RISK_LABELS[risk] ?? risk;
}

export const ACTION_DECISION_LABELS: Record<ActionDecision, string> = {
  execute: "Executa automaticamente",
  approval_required: "Requer aprovação",
  blocked: "Bloqueada",
  shadow: "Shadow (só sugestão)",
};

export function actionDecisionLabel(decision: ActionDecision): string {
  return ACTION_DECISION_LABELS[decision] ?? decision;
}

// Agentes v1.3 — Jobs, Runs, Delegation & Controlled Autonomy (correio.md).
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Rascunho",
  active: "Ativo",
  paused: "Pausado",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function jobStatusLabel(status: JobStatus): string {
  return JOB_STATUS_LABELS[status] ?? status;
}

export const JOB_TRIGGER_TYPE_LABELS: Record<JobTriggerType, string> = {
  manual: "Manual",
  schedule: "Agendado",
  internal_event: "Evento interno",
};

export function jobTriggerTypeLabel(triggerType: JobTriggerType): string {
  return JOB_TRIGGER_TYPE_LABELS[triggerType] ?? triggerType;
}

export const JOB_RUN_STATUS_LABELS: Record<JobRunStatus, string> = {
  queued: "Na fila",
  planning: "Planejando",
  running: "Executando",
  waiting_approval: "Aguardando aprovação",
  completed: "Concluído",
  partial: "Parcialmente concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
  blocked: "Bloqueado",
};

export function jobRunStatusLabel(status: JobRunStatus): string {
  return JOB_RUN_STATUS_LABELS[status] ?? status;
}

// Agentes v1.4 — Event Engine & Autonomous Operations (correio.md).
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  pending: "Pendente",
  processing: "Processando",
  processed: "Processado",
  failed: "Falhou",
  ignored: "Ignorado (nenhuma regra casou)",
};

export function eventStatusLabel(status: EventStatus): string {
  return EVENT_STATUS_LABELS[status] ?? status;
}

export const EVENT_DELIVERY_STATUS_LABELS: Record<EventDeliveryStatus, string> = {
  matched: "Casou",
  triggered: "Disparou Run",
  ignored: "Ignorada",
  failed: "Falhou",
};

export function eventDeliveryStatusLabel(status: EventDeliveryStatus): string {
  return EVENT_DELIVERY_STATUS_LABELS[status] ?? status;
}

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  eq: "é igual a",
  neq: "é diferente de",
  in: "está em",
  not_in: "não está em",
  gt: "é maior que",
  gte: "é maior ou igual a",
  lt: "é menor que",
  lte: "é menor ou igual a",
  exists: "existe",
};

export function filterOperatorLabel(operator: FilterOperator): string {
  return FILTER_OPERATOR_LABELS[operator] ?? operator;
}

// Agentes v1.6 — Operations Control & Observability (correio.md).
export const CIRCUIT_STATE_LABELS: Record<CircuitState, string> = {
  closed: "Fechado",
  open: "Aberto",
  half_open: "Meio-aberto",
};

export function circuitStateLabel(state: CircuitState): string {
  return CIRCUIT_STATE_LABELS[state] ?? state;
}

export const AUTONOMY_BLOCK_REASON_LABELS: Record<AutonomyBlockReason, string> = {
  autonomy_job_disabled: "Autonomia do Job desligada",
  autonomy_depth_exceeded: "Profundidade máxima excedida",
  autonomous_cycle_detected: "Ciclo autônomo detectado",
  autonomy_chain_budget_exceeded: "Orçamento da cadeia excedido",
  autonomous_rate_limit_exceeded: "Rate limit autônomo excedido",
  autonomy_circuit_open: "Circuit breaker aberto",
};

export function autonomyBlockReasonLabel(reason: AutonomyBlockReason): string {
  return AUTONOMY_BLOCK_REASON_LABELS[reason] ?? reason;
}

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  autonomy_circuit_open: "Circuit breaker aberto",
  autonomous_cycle_detected: "Ciclo autônomo detectado",
  autonomy_depth_exceeded: "Profundidade máxima excedida",
  autonomy_chain_budget_exceeded: "Orçamento da cadeia excedido",
  autonomous_rate_limit_exceeded: "Rate limit autônomo excedido",
  job_repeated_failure: "Job com falhas repetidas",
  event_delivery_failed: "Delivery de evento falhou",
};

export function incidentTypeLabel(type: IncidentType): string {
  return INCIDENT_TYPE_LABELS[type] ?? type;
}

// Agentes v1.7 — Agent Management & Operational Configuration (correio.md).
export const SETTING_LABELS: Record<SettingKey, string> = {
  "circuit.failureThreshold": "Circuit breaker — failure threshold",
  "circuit.cooldownSeconds": "Circuit breaker — cooldown (segundos)",
  "autonomy.maxDepth": "Autonomia — profundidade máxima",
  "chain.maxRunsPerAutonomyChain": "Cadeia autônoma — orçamento de Runs",
  "rate.autonomyLimit": "Rate limit — execuções autônomas",
  "rate.autonomyWindowSeconds": "Rate limit — janela (segundos)",
};

export function settingLabel(key: SettingKey): string {
  return SETTING_LABELS[key] ?? key;
}

export const SETTING_SOURCE_LABELS: Record<SettingSource, string> = {
  job: "Override deste Job",
  global: "Global",
  default: "Default",
};

export function settingSourceLabel(source: SettingSource): string {
  return SETTING_SOURCE_LABELS[source] ?? source;
}

// Agrupamento por domínio (correio.md v1.7 "Frontend": "agrupar
// configurações por domínio") — usado tanto na tela /agents/settings
// quanto na seção de overrides do detalhe do Job.
export const SETTING_GROUPS: { title: string; keys: SettingKey[] }[] = [
  { title: "Circuit Breaker", keys: ["circuit.failureThreshold", "circuit.cooldownSeconds"] },
  { title: "Autonomia", keys: ["autonomy.maxDepth"] },
  { title: "Jobs / Runs", keys: ["chain.maxRunsPerAutonomyChain", "rate.autonomyLimit", "rate.autonomyWindowSeconds"] },
];

// Mudanças nestas chaves exigem confirmação de UI (correio.md v1.7
// "Confirmações para mudanças críticas": "Configurações que alterem
// autonomia ou circuit breaker devem exigir confirmação").
export const CRITICAL_SETTING_KEYS: readonly SettingKey[] = [
  "circuit.failureThreshold",
  "circuit.cooldownSeconds",
  "autonomy.maxDepth",
];

export function isCriticalSetting(key: SettingKey): boolean {
  return (CRITICAL_SETTING_KEYS as readonly string[]).includes(key);
}

// Agentes v1.8 — Director Operations & Business Workflows (correio.md).
export const SIGNAL_SEVERITY_LABELS: Record<SignalSeverity, string> = {
  critical: "Crítico",
  warning: "Aviso",
  attention: "Atenção",
  info: "Info",
};

export function signalSeverityLabel(severity: SignalSeverity): string {
  return SIGNAL_SEVERITY_LABELS[severity] ?? severity;
}

export const SIGNAL_DOMAIN_LABELS: Record<SignalDomain, string> = {
  crm: "CRM",
  projects: "Projetos",
  finance: "Financeiro",
  support: "Suporte / CS",
  agents: "Agentes",
};

export function signalDomainLabel(domain: SignalDomain): string {
  return SIGNAL_DOMAIN_LABELS[domain] ?? domain;
}

// Rotas conhecidas para "abrir a entidade relacionada" (correio.md v1.8
// seção 15) — só os entityType que já têm uma página de detalhe real;
// os demais (ex.: agent_approval) ficam sem link, nunca um link quebrado.
// "task" não tem página própria (só existe dentro do detalhe do
// projeto) — usa metadata.projectId, nunca o id da própria tarefa.
export function signalEntityHref(signal: {
  entityType?: string;
  entityId?: number;
  metadata: Record<string, unknown>;
}): string | null {
  if (!signal.entityType) return null;

  switch (signal.entityType) {
    case "lead":
      return signal.entityId ? `/leads/${signal.entityId}` : null;
    case "task": {
      const projectId = signal.metadata.projectId;
      return typeof projectId === "number" ? `/projects/${projectId}` : null;
    }
    case "project":
      return signal.entityId ? `/projects/${signal.entityId}` : null;
    case "financial_entry":
      return signal.entityId ? `/financial/${signal.entityId}` : null;
    case "support_ticket":
      return signal.entityId ? `/support/${signal.entityId}` : null;
    case "customer_success_account":
      return signal.entityId ? `/customer-success/${signal.entityId}` : null;
    case "agent_job":
      return signal.entityId ? `/agents/jobs/${signal.entityId}` : null;
    default:
      return null;
  }
}

// Agentes v1.9 — Director Decision Queue (correio.md seção 25/26/33).
export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  open: "Aberto",
  acknowledged: "Reconhecido",
  action_planned: "Plano criado",
  awaiting_approval: "Aguardando aprovação",
  resolved: "Resolvido",
  dismissed: "Dispensado",
};

export function decisionStatusLabel(status: DecisionStatus): string {
  return DECISION_STATUS_LABELS[status] ?? status;
}

// Estados terminais/somente-leitura — nenhuma ação de ciclo de vida
// (acknowledge/assign/dismiss/propose) faz sentido a partir daqui.
export const DECISION_CLOSED_STATUSES: readonly DecisionStatus[] = ["resolved", "dismissed"];

export function isDecisionClosed(status: DecisionStatus): boolean {
  return DECISION_CLOSED_STATUSES.includes(status);
}

export const DECISION_IMPACT_LABELS: Record<DecisionImpact, string> = {
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
};

export function decisionImpactLabel(impact: DecisionImpact): string {
  return DECISION_IMPACT_LABELS[impact] ?? impact;
}

export const DECISION_URGENCY_LABELS: Record<DecisionUrgency, string> = {
  immediate: "Imediata",
  soon: "Em breve",
  normal: "Normal",
};

export function decisionUrgencyLabel(urgency: DecisionUrgency): string {
  return DECISION_URGENCY_LABELS[urgency] ?? urgency;
}

// Só pode propor ação a partir de "open"/"acknowledged" (mesma regra do
// backend — actions-service.ts — duplicada aqui apenas para UX, o
// backend é quem realmente barra).
export function canProposeActionForDecision(status: DecisionStatus): boolean {
  return status === "open" || status === "acknowledged";
}

export function daysOpen(firstDetectedAt: string, now: Date = new Date()): number {
  const detected = new Date(firstDetectedAt);
  const diffMs = now.getTime() - detected.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}
