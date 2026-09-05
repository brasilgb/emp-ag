import type {
  ActionDecision,
  ActionPlanItemStatus,
  ActionPlanStatus,
  ActionRisk,
  AgingBucket,
  ApprovalStatus,
  AttentionReason,
  AutonomyBlockReason,
  AutonomyLevel,
  ChatResponse,
  CircuitState,
  DecisionImpact,
  DecisionStatus,
  DecisionUrgency,
  ActionProposalStatus,
  EscalationPolicy,
  EscalationSeverity,
  EscalationStatus,
  EventDeliveryStatus,
  FollowUpPriority,
  FollowUpSourceType,
  FollowUpStatus,
  EventStatus,
  ExecutionStatus,
  FilterOperator,
  GoalHealth,
  GoalPriority,
  GoalStatus,
  HumanVerdict,
  IncidentType,
  InitiativeExecutionState,
  MemoryImportance,
  MemoryStatus,
  MemoryType,
  OperationalHealthStatus,
  OperationalIncidentSlaStatus,
  OperationalIncidentTimelineEventType,
  OperationalIncidentType,
  OperationalResponse,
  OperationalSeverity,
  RecommendationType,
  RecoveryResult,
  ResponsibilityPriority,
  ResponsibilityType,
  ReviewOutcome,
  SchedulerLastResult,
  WorkflowType,
  InitiativeStatus,
  InterpretationCategory,
  InterpretationErrorType,
  JobRunStatus,
  JobStatus,
  JobTriggerType,
  SettingKey,
  SettingSource,
  SignalDomain,
  SignalSeverity,
  IncidentReviewStatusOrUnreviewed,
  SupervisionIncidentOutcome,
  SupervisionRunStatus,
  SupervisionRunTriggerSource,
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

// Agentes v2.0 — Director Goals, Initiatives & Executive Planning (correio.md).
export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  draft: "Rascunho",
  active: "Ativo",
  paused: "Pausado",
  achieved: "Alcançado",
  missed: "Não alcançado",
  cancelled: "Cancelado",
};

export function goalStatusLabel(status: GoalStatus): string {
  return GOAL_STATUS_LABELS[status] ?? status;
}

export const GOAL_HEALTH_LABELS: Record<GoalHealth, string> = {
  on_track: "No caminho certo",
  attention: "Atenção",
  at_risk: "Em risco",
  critical: "Crítico",
  unknown: "Sem avaliação",
};

export function goalHealthLabel(health: GoalHealth): string {
  return GOAL_HEALTH_LABELS[health] ?? health;
}

export const GOAL_PRIORITY_LABELS: Record<GoalPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export function goalPriorityLabel(priority: GoalPriority): string {
  return GOAL_PRIORITY_LABELS[priority] ?? priority;
}

export const INITIATIVE_STATUS_LABELS: Record<InitiativeStatus, string> = {
  proposed: "Proposta",
  approved: "Aprovada",
  active: "Ativa",
  blocked: "Bloqueada",
  completed: "Concluída",
  cancelled: "Cancelada",
};

export function initiativeStatusLabel(status: InitiativeStatus): string {
  return INITIATIVE_STATUS_LABELS[status] ?? status;
}

export const OPEN_GOAL_STATUSES: readonly GoalStatus[] = ["draft", "active", "paused"];
export function isGoalClosed(status: GoalStatus): boolean {
  return !OPEN_GOAL_STATUSES.includes(status);
}

export const OPEN_INITIATIVE_STATUSES: readonly InitiativeStatus[] = ["proposed", "approved", "active", "blocked"];
export function isInitiativeClosed(status: InitiativeStatus): boolean {
  return !OPEN_INITIATIVE_STATUSES.includes(status);
}

// Mesma regra do backend (initiatives-service.ts) — só a partir de "approved".
export function canProposeActionForInitiative(status: InitiativeStatus): boolean {
  return status === "approved";
}

export function daysRemaining(targetDate: string, now: Date = new Date()): number {
  const target = new Date(targetDate);
  return Math.ceil((target.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

// Agentes v2.1 — Initiative Execution & Progress Tracking (correio.md).
export const INITIATIVE_EXECUTION_STATE_LABELS: Record<InitiativeExecutionState, string> = {
  not_started: "Não iniciada",
  waiting_approval: "Aguardando aprovação",
  running: "Em execução",
  blocked: "Bloqueada",
  failed: "Com falha",
  completed: "Concluída",
};

export function initiativeExecutionStateLabel(state: InitiativeExecutionState): string {
  return INITIATIVE_EXECUTION_STATE_LABELS[state] ?? state;
}

// Agentes v2.2 — Executive Review & Strategic Feedback Loop (correio.md seção 20).
export const REVIEW_OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  successful: "Bem-sucedido",
  partially_successful: "Parcialmente bem-sucedido",
  unsuccessful: "Sem sucesso",
  inconclusive: "Inconclusivo",
  blocked: "Bloqueado",
};

export function reviewOutcomeLabel(outcome: ReviewOutcome): string {
  return REVIEW_OUTCOME_LABELS[outcome] ?? outcome;
}

export const RECOMMENDATION_TYPE_LABELS: Record<RecommendationType, string> = {
  none: "Nenhuma ação necessária",
  continue: "Continuar estratégia atual",
  adjust: "Ajustar estratégia",
  new_initiative: "Propor nova iniciativa",
  escalate: "Escalar para decisão do CEO",
};

export function recommendationTypeLabel(type: RecommendationType): string {
  return RECOMMENDATION_TYPE_LABELS[type] ?? type;
}

// Agentes v2.3 — Strategic Learning & Organizational Memory (correio.md seção 19).
export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  initiative_outcome: "Resultado de iniciativa",
  strategic_lesson: "Lição estratégica",
  decision_outcome: "Resultado de decisão",
  recurring_pattern: "Padrão recorrente",
};

export function memoryTypeLabel(type: MemoryType): string {
  return MEMORY_TYPE_LABELS[type] ?? type;
}

export const MEMORY_STATUS_LABELS: Record<MemoryStatus, string> = {
  draft: "Gerando...",
  active: "Ativa",
  superseded: "Substituída",
  archived: "Arquivada",
};

export function memoryStatusLabel(status: MemoryStatus): string {
  return MEMORY_STATUS_LABELS[status] ?? status;
}

export const MEMORY_IMPORTANCE_LABELS: Record<MemoryImportance, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

export function memoryImportanceLabel(importance: MemoryImportance): string {
  return MEMORY_IMPORTANCE_LABELS[importance] ?? importance;
}

// Agentes v2.4 — Workflow Recovery, Reconciliation & Operational Resilience.
export const RECOVERY_RESULT_LABELS: Record<RecoveryResult, string> = {
  recovered: "Recuperado",
  retried: "Nova tentativa",
  reverted: "Revertido",
  marked_failed: "Marcado como falho",
  manual_attention: "Atenção manual",
  skipped: "Ignorado (nada a fazer)",
};

export function recoveryResultLabel(result: RecoveryResult): string {
  return RECOVERY_RESULT_LABELS[result] ?? result;
}

export const WORKFLOW_TYPE_LABELS: Record<WorkflowType, string> = {
  initiative: "Initiative",
  executive_review: "Executive Review",
  strategic_memory: "Strategic Memory",
};

export function workflowTypeLabel(type: WorkflowType): string {
  return WORKFLOW_TYPE_LABELS[type] ?? type;
}

// Agentes v2.5 — Operational Supervision & Autonomous Incident Response.
export const OPERATIONAL_HEALTH_STATUS_LABELS: Record<OperationalHealthStatus, string> = {
  healthy: "Saudável",
  degraded: "Degradado",
  attention_required: "Atenção necessária",
  restricted: "Restrito",
};

export function operationalHealthStatusLabel(status: OperationalHealthStatus): string {
  return OPERATIONAL_HEALTH_STATUS_LABELS[status] ?? status;
}

export const OPERATIONAL_SEVERITY_LABELS: Record<OperationalSeverity, string> = {
  info: "Informativo",
  warning: "Atenção",
  critical: "Crítico",
};

export function operationalSeverityLabel(severity: OperationalSeverity): string {
  return OPERATIONAL_SEVERITY_LABELS[severity] ?? severity;
}

export const OPERATIONAL_INCIDENT_TYPE_LABELS: Record<OperationalIncidentType, string> = {
  recovery_required: "Recuperação necessária",
  repeated_job_failure: "Falha repetida de Job",
  run_stuck: "Execução presa",
  delivery_failure: "Falha de delivery",
  manual_attention_required: "Atenção manual necessária",
  autonomy_circuit_open: "Circuit Breaker aberto",
  approval_bottleneck: "Gargalo de aprovações",
  operational_degradation: "Degradação operacional",
};

export function operationalIncidentTypeLabel(type: OperationalIncidentType): string {
  return OPERATIONAL_INCIDENT_TYPE_LABELS[type] ?? type;
}

export const OPERATIONAL_RESPONSE_LABELS: Record<OperationalResponse, string> = {
  observe: "Observar",
  safe_recovery: "Recuperação segura",
  restrict_autonomy: "Restringir autonomia",
  manual_attention: "Atenção manual",
  already_handled: "Já tratado",
};

export function operationalResponseLabel(response: OperationalResponse): string {
  return OPERATIONAL_RESPONSE_LABELS[response] ?? response;
}

// Agentes v2.5.1 — Automatic Operational Supervision.
export const SCHEDULER_LAST_RESULT_LABELS: Record<SchedulerLastResult, string> = {
  success: "Sucesso",
  failed: "Falhou",
  skipped: "Ignorado (sobreposição)",
};

export function schedulerLastResultLabel(result: SchedulerLastResult): string {
  return SCHEDULER_LAST_RESULT_LABELS[result] ?? result;
}

// Agentes v2.6 — Agent Responsibilities, Operational Ownership & Escalation.
export const RESPONSIBILITY_TYPE_LABELS: Record<ResponsibilityType, string> = {
  monitor: "Monitorar",
  review: "Revisar",
  coordinate: "Coordenar",
  follow_up: "Acompanhar",
};

export function responsibilityTypeLabel(type: ResponsibilityType): string {
  return RESPONSIBILITY_TYPE_LABELS[type] ?? type;
}

export const RESPONSIBILITY_PRIORITY_LABELS: Record<ResponsibilityPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export function responsibilityPriorityLabel(priority: ResponsibilityPriority): string {
  return RESPONSIBILITY_PRIORITY_LABELS[priority] ?? priority;
}

export const ESCALATION_POLICY_LABELS: Record<EscalationPolicy, string> = {
  none: "Não escala",
  agent: "Agente",
  human: "Humano",
  agent_then_human: "Agente + Humano",
};

export function escalationPolicyLabel(policy: EscalationPolicy): string {
  return ESCALATION_POLICY_LABELS[policy] ?? policy;
}

export const ESCALATION_SEVERITY_LABELS: Record<EscalationSeverity, string> = {
  info: "Informativo",
  warning: "Atenção",
  critical: "Crítico",
};

export function escalationSeverityLabel(severity: EscalationSeverity): string {
  return ESCALATION_SEVERITY_LABELS[severity] ?? severity;
}

export const ESCALATION_STATUS_LABELS: Record<EscalationStatus, string> = {
  open: "Aberta",
  acknowledged: "Reconhecida",
  resolved: "Resolvida",
  dismissed: "Descartada",
};

export function escalationStatusLabel(status: EscalationStatus): string {
  return ESCALATION_STATUS_LABELS[status] ?? status;
}

// Agentes v2.7 — Operational Follow-up & Coordinated Workflows.
export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  open: "Aberto",
  in_progress: "Em andamento",
  waiting: "Aguardando",
  completed: "Concluído",
  dismissed: "Descartado",
};

export function followUpStatusLabel(status: FollowUpStatus): string {
  return FOLLOW_UP_STATUS_LABELS[status] ?? status;
}

export const FOLLOW_UP_PRIORITY_LABELS: Record<FollowUpPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export function followUpPriorityLabel(priority: FollowUpPriority): string {
  return FOLLOW_UP_PRIORITY_LABELS[priority] ?? priority;
}

export const FOLLOW_UP_SOURCE_TYPE_LABELS: Record<FollowUpSourceType, string> = {
  escalation: "Escalation",
  responsibility: "Responsibility",
};

export function followUpSourceTypeLabel(sourceType: FollowUpSourceType): string {
  return FOLLOW_UP_SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}

// Agentes v2.8 — Operational Actions & Governed Resolution. Labels
// derivados dos estados reais do sistema (seção 19: "esses labels devem
// derivar dos estados reais do sistema" — nunca um vocabulário
// inventado à parte).
export const ACTION_PROPOSAL_STATUS_LABELS: Record<ActionProposalStatus, string> = {
  submitted: "Proposta",
  planned: "Planejada",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export function actionProposalStatusLabel(status: ActionProposalStatus): string {
  return ACTION_PROPOSAL_STATUS_LABELS[status] ?? status;
}

// Agentes v3.4 — Operational Supervision Observability & Run History.
// Labels distinguindo explicitamente `completed_with_failures` de um
// `succeeded` puro, e `skipped_already_running` de uma falha real
// (correio.md "14. Frontend": "rótulos de status claros, distinguindo
// completed_with_failures de succeeded puro, e skipped_already_running de
// uma falha real").
export const SUPERVISION_RUN_STATUS_LABELS: Record<SupervisionRunStatus, string> = {
  running: "Em execução",
  succeeded: "Sucesso",
  completed_with_failures: "Concluído com falhas",
  failed: "Falhou",
  skipped_already_running: "Pulado (já em execução)",
};

export function supervisionRunStatusLabel(status: SupervisionRunStatus): string {
  return SUPERVISION_RUN_STATUS_LABELS[status] ?? status;
}

export const SUPERVISION_RUN_TRIGGER_SOURCE_LABELS: Record<SupervisionRunTriggerSource, string> = {
  scheduler: "Automático",
  manual: "Manual",
};

export function supervisionRunTriggerSourceLabel(triggerSource: SupervisionRunTriggerSource): string {
  return SUPERVISION_RUN_TRIGGER_SOURCE_LABELS[triggerSource] ?? triggerSource;
}

// Agentes v3.5 — Operational Supervision Insights & Incident Review.
// `skipped` deliberadamente distinto de `observed` (correio.md "3.
// Incident Review": "resultado") — um branch defensivo sem side effect
// (entidade não recuperável/já resolvida) não é o mesmo que uma decisão
// consciente de só observar.
export const SUPERVISION_INCIDENT_OUTCOME_LABELS: Record<SupervisionIncidentOutcome, string> = {
  observed: "Observado",
  recovered: "Recuperado",
  autonomy_restricted: "Autonomia restrita",
  escalated: "Escalado",
  failed: "Falhou",
  skipped: "Ignorado (sem ação aplicável)",
};

export function supervisionIncidentOutcomeLabel(outcome: SupervisionIncidentOutcome): string {
  return SUPERVISION_INCIDENT_OUTCOME_LABELS[outcome] ?? outcome;
}

// Agentes v3.6 — Operational Incident Acknowledgement & Review Workflow.
// Dimensão SEPARADA de `supervisionIncidentOutcomeLabel` acima
// (correio.md seção 8/9: "Resultado operacional" vs. "Review humano",
// nunca misturados na UI).
export const INCIDENT_REVIEW_STATUS_LABELS: Record<IncidentReviewStatusOrUnreviewed, string> = {
  unreviewed: "Não revisado",
  acknowledged: "Reconhecido",
  resolved: "Resolvido",
  dismissed: "Dispensado",
};

export function incidentReviewStatusLabel(status: IncidentReviewStatusOrUnreviewed): string {
  return INCIDENT_REVIEW_STATUS_LABELS[status] ?? status;
}

export function formatAgeSeconds(ageSeconds: number): string {
  if (ageSeconds < 60) return `${ageSeconds}s`;
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}min`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h`;
  return `${Math.floor(ageSeconds / 86400)}d`;
}

// Agentes v3.7 — Operational Incident Review Queue & Attention Management.
// Buckets fixos definidos em backend/src/agents/operations/
// supervision-insights-service.ts (`AGING_BUCKETS`) — vocabulário fechado,
// nenhum cálculo de aging no frontend (correio.md "Aging": "calcular em
// tempo de leitura" é responsabilidade exclusiva do backend).
export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  "<1h": "< 1h",
  "1h-4h": "1h – 4h",
  "4h-24h": "4h – 24h",
  ">24h": "> 24h",
};

export function agingBucketLabel(bucket: AgingBucket): string {
  return AGING_BUCKET_LABELS[bucket] ?? bucket;
}

// Explica por que um incidente está na fila Needs Attention (correio.md
// "Frontend": "por que aquele incidente aparece acima de outro") — nunca
// um score opaco, sempre um destes motivos textuais e determinísticos.
export const ATTENTION_REASON_LABELS: Record<AttentionReason, string> = {
  unreviewed: "Não revisado",
  acknowledged_pending: "Reconhecido, ainda pendente",
  recurring: "Recorrente",
  high_severity: "Severidade crítica",
  aging: "Aguardando há muito tempo",
};

export function attentionReasonLabel(reason: AttentionReason): string {
  return ATTENTION_REASON_LABELS[reason] ?? reason;
}

// Agentes v4.0 — Operational Incident Collaboration & Activity Timeline.
export const OPERATIONAL_INCIDENT_TIMELINE_EVENT_LABELS: Record<OperationalIncidentTimelineEventType, string> = {
  incident_detected: "Incidente detectado",
  review_acknowledged: "reconheceu o incidente",
  review_status_changed: "Status de review alterado",
  assigned: "Incidente atribuído",
  reassigned: "Responsável alterado",
  unassigned: "Responsável removido",
  escalation_created: "Escalation criada",
  follow_up_created: "Follow-up criado",
};

export function operationalIncidentTimelineEventLabel(type: OperationalIncidentTimelineEventType): string {
  return OPERATIONAL_INCIDENT_TIMELINE_EVENT_LABELS[type] ?? type;
}

// Agentes v4.1 — Operational Incident Aging & SLA Visibility (correio.md
// seção 11: "o frontend não deve possuir uma implementação concorrente
// da política de SLA" — este arquivo só FORMATA `status`/`remainingSeconds`
// já decididos pelo backend, nunca decide se algo está vencido).
export const OPERATIONAL_INCIDENT_SLA_STATUS_LABELS: Record<OperationalIncidentSlaStatus, string> = {
  within_sla: "Dentro do prazo",
  warning: "Próximo do vencimento",
  breached: "SLA vencido",
  completed: "Encerrado",
};

export function operationalIncidentSlaStatusLabel(status: OperationalIncidentSlaStatus): string {
  return OPERATIONAL_INCIDENT_SLA_STATUS_LABELS[status] ?? status;
}

/**
 * "Restam 12min" / "Vencido há 7min" (correio.md "10. Frontend",
 * exemplos literais) — pura formatação de um `remainingSeconds` já
 * calculado no backend, nunca uma segunda política.
 */
export function formatSlaRemainingLabel(remainingSeconds: number | null): string {
  if (remainingSeconds === null) return "--";
  if (remainingSeconds >= 0) return `Restam ${formatAgeSeconds(remainingSeconds)}`;
  return `Vencido há ${formatAgeSeconds(Math.abs(remainingSeconds))}`;
}

// Agentes v4.2 — Operational SLA Analytics & Performance Visibility
// (correio.md seção 17). `formatAgeSeconds` acima só mostra UMA unidade
// (nunca "1h 32min") — insuficiente para os cards de Response Times, que
// pedem exatamente essa combinação (seção 17, exemplos literais: "45s",
// "8m", "1h 32m", "2d 4h"). Aqui reproduzido com "min" em vez de "m" —
// mesma abreviação já usada por `formatSlaRemainingLabel`/`formatAgeSeconds`
// nesta MESMA tela (nunca duas convenções de unidade de tempo na mesma
// página); a forma (unidades combinadas) é a mesma do exemplo do
// correio.md, só o rótulo da unidade segue o precedente local.
export function formatOperationalDuration(seconds: number | null): string {
  if (seconds === null) return "--";
  if (seconds < 60) return `${seconds}s`;

  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}min`;

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) return remainingMinutes > 0 ? `${totalHours}h ${remainingMinutes}min` : `${totalHours}h`;

  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours > 0 ? `${totalDays}d ${remainingHours}h` : `${totalDays}d`;
}

/**
 * `0.0842 → "8.4%"` (correio.md seção 17, exemplo literal) — uma casa
 * decimal, nunca arredondamento silencioso para inteiro (perderia a
 * diferença entre, por exemplo, 8.4% e 8.6% de breach rate). `null`
 * (denominador zero, seção 5) é SEMPRE "sem dado", nunca "0%" — `0` é um
 * valor real (breach rate genuinamente zero) e `null` é a ausência de
 * base de cálculo; jamais confundir os dois (correio.md seção 18: nunca
 * `0%`/`NaN%`/`Infinity%` quando o correto é "--").
 */
export function formatOperationalPercentage(value: number | null): string {
  if (value === null) return "--";
  return `${(value * 100).toFixed(1)}%`;
}
