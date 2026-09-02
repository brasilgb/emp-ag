export type { Paginated, PaginationMeta } from "./shared";

export const AGENT_DEPARTMENTS = [
  "director",
  "sales",
  "projects",
  "finance",
  "support",
  "customer_success",
] as const;
export type AgentDepartment = (typeof AGENT_DEPARTMENTS)[number];

export const AGENT_STATUSES = ["active", "paused", "disabled"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AUTONOMY_LEVELS = ["read", "prepare", "execute", "approval_required"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const EXECUTION_STATUSES = [
  "pending",
  "running",
  "waiting_approval",
  "approved",
  "rejected",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const CONVERSATION_STATUSES = ["active", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Agent {
  id: number;
  name: string;
  slug: string;
  department: AgentDepartment;
  description: string | null;
  systemPrompt: string | null;
  status: AgentStatus;
  isSystem: boolean;
  isActive: boolean;
  defaultAutonomyLevel: AutonomyLevel;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTool {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  department: AgentDepartment;
  autonomyLevel: AutonomyLevel;
  handler: string;
  isActive: boolean;
  isSensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolForAgent extends AgentTool {
  canUse: boolean;
  requiresApprovalOverride: boolean;
}

export interface AgentExecution {
  id: number;
  agentId: number;
  agentName: string;
  agentSlug: string;
  userId: number | null;
  userName: string | null;
  conversationId: number | null;
  toolId: number;
  toolHandler: string;
  toolName: string;
  status: ExecutionStatus;
  autonomyLevel: AutonomyLevel;
  input: unknown;
  output: unknown;
  error: { code: string; message: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AgentApproval {
  id: number;
  // Agentes v1.2: uma aprovação agora pode ser de uma execução única
  // (v1.1, executionId preenchido) ou de um item de Action Plan
  // (planItemId preenchido) — nunca os dois. `kind` diz qual é.
  kind: "execution" | "plan_item";
  executionId: number | null;
  planItemId: number | null;
  planId: number | null;
  toolHandler: string;
  toolName: string;
  agentName: string | null;
  agentSlug: string | null;
  requestedForUserId: number | null;
  requestedForUserName: string | null;
  status: ApprovalStatus;
  reason: string | null;
  requestPayload: unknown;
  decisionPayload: unknown;
  approvedByUserId: number | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface AgentConversation {
  id: number;
  userId: number;
  title: string | null;
  status: ConversationStatus;
  context: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: number;
  conversationId: number;
  agentId: number | null;
  role: MessageRole;
  content: string;
  metadata: { toolHandler?: string; executionId?: number } | null;
  createdAt: string;
}

export interface AgentConversationDetail extends AgentConversation {
  messages: AgentMessage[];
}

export interface ChatResponse {
  conversationId: number;
  agent: { slug: string; name: string } | null;
  tool: string | null;
  message: string;
  data: unknown;
  executionId?: number;
  status?: string;
  clarificationRequired?: boolean;
}

// v1.1 — LLM Interpreter + Shadow Mode.
export const INTERPRETATION_CATEGORIES = [
  "match",
  "mismatch",
  "deterministic_unknown_llm_recognized",
  "both_unknown",
] as const;
export type InterpretationCategory = (typeof INTERPRETATION_CATEGORIES)[number];

// Seção 30 — feedback humano simples, nunca retreina o modelo automaticamente.
export const HUMAN_VERDICTS = ["correct", "incorrect"] as const;
export type HumanVerdict = (typeof HUMAN_VERDICTS)[number];

// Seção 30-bis — taxonomia curta de erro/classificação do LLM Interpreter.
// low_confidence/clarification são resultados válidos do modelo (não
// falhas de infra), mas ainda ganham uma classificação curta em `error`
// para observabilidade — nunca contam em `errors`, só em `errorsByType`.
export const INTERPRETATION_ERROR_TYPES = [
  "timeout",
  "provider_http_error",
  "provider_error",
  "invalid_json",
  "schema_validation_error",
  "invalid_agent",
  "invalid_tool",
  "invalid_arguments",
  "low_confidence",
  "clarification",
] as const;
export type InterpretationErrorType = (typeof INTERPRETATION_ERROR_TYPES)[number];

// Já sanitizado pelo backend (llm/error-classification.ts) antes de
// persistir — nunca contém API key/headers/credenciais. `statusCode` só
// existe para type === 'provider_http_error'.
export interface InterpretationError {
  type: InterpretationErrorType;
  message: string | null;
  statusCode?: number;
}

export interface InterpretationEntry {
  id: number;
  conversationId: number;
  userMessage: string | null;
  deterministicAgent: string | null;
  deterministicTool: string | null;
  llmAgent: string | null;
  llmTool: string | null;
  llmConfidence: string | null;
  matched: boolean | null;
  mode: "shadow" | "fallback";
  error: InterpretationError | null;
  category: InterpretationCategory;
  createdAt: string;
  humanVerdict: HumanVerdict | null;
  reviewedByUserId: number | null;
  reviewedByUserName: string | null;
  reviewedAt: string | null;
}

// Agentes v1.2 — Action Planning + Approval Workflow (correio.md).
export const ACTION_PLAN_STATUSES = [
  "draft",
  "evaluating",
  "waiting_approval",
  "executing",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];

export const ACTION_PLAN_ITEM_STATUSES = [
  "pending",
  "waiting_approval",
  "approved",
  "executing",
  "completed",
  "failed",
  "blocked",
  "rejected",
  "skipped",
] as const;
export type ActionPlanItemStatus = (typeof ACTION_PLAN_ITEM_STATUSES)[number];

export const ACTION_RISKS = ["read", "low", "medium", "high"] as const;
export type ActionRisk = (typeof ACTION_RISKS)[number];

export const ACTION_DECISIONS = ["execute", "approval_required", "blocked", "shadow"] as const;
export type ActionDecision = (typeof ACTION_DECISIONS)[number];

export interface ActionPlan {
  id: number;
  requestedBy: number;
  objective: string;
  summary: string;
  status: ActionPlanStatus;
  llmProvider: string | null;
  llmModel: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ActionPlanItem {
  id: number;
  planId: number;
  sequence: number;
  actionId: string;
  agent: string;
  agentId: number;
  tool: string;
  toolId: number;
  arguments: unknown;
  dependencies: string[] | null;
  reason: string | null;
  confidence: string | null;
  risk: ActionRisk;
  decision: ActionDecision;
  decisionReason: string | null;
  executionStatus: ActionPlanItemStatus;
  result: { success: boolean; summary: string; data: unknown; metadata?: Record<string, unknown> } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  executedAt: string | null;
}

export interface ActionPlanDetail {
  plan: ActionPlan;
  items: ActionPlanItem[];
}

// Agentes v1.3 — Jobs, Runs, Delegation & Controlled Autonomy (correio.md).
export const JOB_STATUSES = ["draft", "active", "paused", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TRIGGER_TYPES = ["manual", "schedule", "internal_event"] as const;
export type JobTriggerType = (typeof JOB_TRIGGER_TYPES)[number];

export const JOB_RUN_STATUSES = [
  "queued",
  "planning",
  "running",
  "waiting_approval",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "blocked",
] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export type ScheduleConfig = { frequency: "daily"; hour: number; minute: number } | { frequency: "hourly"; interval: number };

export interface AgentJob {
  id: number;
  name: string;
  description: string | null;
  objective: string;
  agentId: number;
  createdBy: number;
  status: JobStatus;
  triggerType: JobTriggerType;
  scheduleConfig: ScheduleConfig | null;
  eventConfig: { event: string } | null;
  maxRunsPerDay: number;
  maxActionsPerRun: number;
  maxOpenApprovals: number;
  timeoutSeconds: number;
  shadowMode: boolean;
  allowConcurrentRuns: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  // Agentes v1.5 — Autonomous Safety & Governance. Nunca expostos no
  // frontend até a v1.6 (correio.md v1.6 seção 8 — Circuit breaker
  // visibility): o backend já os retornava, só não havia UI para eles.
  autonomyEnabled: boolean;
  circuitState: CircuitState;
  circuitFailureCount: number;
  circuitOpenedAt: string | null;
  autonomyRateLimitOverride: number | null;
  autonomyRateWindowOverrideSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export const CIRCUIT_STATES = ["closed", "open", "half_open"] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

// Agentes v1.4 — Event Engine & Autonomous Operations (correio.md).
export const EVENT_STATUSES = ["pending", "processing", "processed", "failed", "ignored"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const FILTER_OPERATORS = ["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "exists"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export type FilterFieldType = "string" | "number" | "boolean";

export type FilterCondition = Partial<Record<FilterOperator, string | number | boolean | (string | number | boolean)[]>>;
export type EventFilters = Record<string, FilterCondition>;

export interface EventCatalogEntry {
  type: string;
  version: number;
  domain: string;
  description: string;
  filterableFields: Record<string, FilterFieldType>;
  operators: readonly FilterOperator[];
}

export interface AgentEvent {
  id: number;
  eventType: string;
  eventVersion: number;
  source: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: unknown;
  idempotencyKey: string | null;
  status: EventStatus;
  occurredAt: string;
  receivedAt: string;
  processedAt: string | null;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  // Agentes v1.5 — lineage de eventos causados por Run (correio.md v1.6
  // seção 4/14).
  causedByRunId: number | null;
  rootExecutionId: number | null;
  autonomyDepth: number | null;
  createdAt: string;
  updatedAt: string;
}

export const EVENT_DELIVERY_STATUSES = ["matched", "triggered", "ignored", "failed"] as const;
export type EventDeliveryStatus = (typeof EVENT_DELIVERY_STATUSES)[number];

export interface AgentEventDelivery {
  id: number;
  eventId: number;
  ruleId: number;
  jobId: number;
  jobRunId: number | null;
  status: EventDeliveryStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface AgentEventDetail {
  event: AgentEvent;
  deliveries: AgentEventDelivery[];
}

export interface AgentEventRule {
  id: number;
  name: string;
  description: string | null;
  eventType: string;
  eventVersion: number;
  jobId: number;
  filters: EventFilters;
  enabled: boolean;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentJobRun {
  id: number;
  jobId: number;
  triggerType: JobTriggerType;
  triggerPayload: unknown;
  status: JobRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  actionPlanId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  // Agentes v1.5 — Execution lineage (correio.md v1.6 seções 4/5).
  rootExecutionId: number | null;
  causationRunId: number | null;
  causationEventDeliveryId: number | null;
  autonomyDepth: number;
  createdAt: string;
}

export interface InterpreterStats {
  llmEnabled: boolean;
  shadowMode: boolean;
  provider: string;
  model: string;
  total: number;
  matches: number;
  mismatches: number;
  // Nem um nem outro — fora do cálculo de match rate (seção 30-bis).
  bothUnknown: number;
  deterministicUnknownLlmRecognized: number;
  matchRate: number | null;
  averageConfidence: number | null;
  averageLatencyMs: number | null;
  timeouts: number;
  errors: number;
  errorsByType: Record<InterpretationErrorType, number>;
  reviewed: number;
  humanCorrect: number;
  humanIncorrect: number;
  humanAccuracy: number | null;
  recentInterpretations: InterpretationEntry[];
}

// Agentes v1.6 — Operations Control & Observability (correio.md).

export interface OperationsSummary {
  period: { from: string; to: string };
  jobs: {
    total: number;
    active: number;
    paused: number;
    draft: number;
    completed: number;
    failed: number;
    cancelled: number;
    autonomyDisabled: number;
    circuitOpen: number;
    circuitHalfOpen: number;
  };
  runs: {
    queued: number;
    planning: number;
    running: number;
    waitingApproval: number;
    completed: number;
    partial: number;
    failed: number;
    blocked: number;
    cancelled: number;
  };
  autonomous: {
    blockedTotal: number;
    cycleDetected: number;
    rateLimited: number;
    depthExceeded: number;
    chainBudgetExceeded: number;
    circuitOpenBlocks: number;
    jobDisabledBlocks: number;
    reasons: readonly string[];
  };
  events: {
    created: number;
    processed: number;
    pending: number;
    ignored: number;
    failed: number;
    deliveriesFailed: number;
  };
  approvals: {
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    cancelled: number;
  };
}

export const INCIDENT_TYPES = [
  "autonomy_circuit_open",
  "autonomous_cycle_detected",
  "autonomy_depth_exceeded",
  "autonomy_chain_budget_exceeded",
  "autonomous_rate_limit_exceeded",
  "job_repeated_failure",
  "event_delivery_failed",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export interface Incident {
  id: string;
  type: IncidentType;
  occurredAt: string;
  jobId: number | null;
  ruleId: number | null;
  eventId: number | null;
  rootExecutionId: number | null;
  summary: string;
  details: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: number;
  userId: number | null;
  actorType: "user" | "agent" | "system" | "n8n" | "worker";
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  oldData: unknown;
  newData: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface GlobalAutonomyState {
  enabled: boolean;
}

export interface JobRunDetail {
  run: AgentJobRun;
  actionPlan: ActionPlan | null;
  planItems: ActionPlanItem[];
  causedByDelivery: AgentEventDelivery | null;
  eventsPublished: AgentEvent[];
  childRuns: AgentJobRun[];
}

export interface JobRunLineage {
  rootExecutionId: number;
  runs: AgentJobRun[];
  blocks: AutonomyBlock[];
}

export const AUTONOMY_BLOCK_REASONS = [
  "autonomy_job_disabled",
  "autonomy_depth_exceeded",
  "autonomous_cycle_detected",
  "autonomy_chain_budget_exceeded",
  "autonomous_rate_limit_exceeded",
  "autonomy_circuit_open",
] as const;
export type AutonomyBlockReason = (typeof AUTONOMY_BLOCK_REASONS)[number];

export interface AutonomyBlock {
  id: number;
  jobId: number;
  ruleId: number | null;
  eventId: number | null;
  triggerType: JobTriggerType;
  reason: AutonomyBlockReason;
  rootExecutionId: number | null;
  causationRunId: number | null;
  attemptedDepth: number;
  limitValue: number | null;
  currentValue: number | null;
  createdAt: string;
}

// Agentes v1.7 — Agent Management & Operational Configuration (correio.md).
export const SETTING_KEYS = [
  "circuit.failureThreshold",
  "circuit.cooldownSeconds",
  "autonomy.maxDepth",
  "chain.maxRunsPerAutonomyChain",
  "rate.autonomyLimit",
  "rate.autonomyWindowSeconds",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type SettingSource = "job" | "global" | "default";

export interface ResolvedSetting {
  key: SettingKey;
  configuredValue: number | null;
  effectiveValue: number;
  source: SettingSource;
  defaultValue: number;
  type: "number" | "boolean";
  min: number;
  max: number;
  description: string;
  scopes: readonly ("global" | "job")[];
}

// Agentes v1.8 — Director Operations & Business Workflows (correio.md).
export type SignalDomain = "crm" | "projects" | "finance" | "support" | "agents";
export type SignalSeverity = "info" | "attention" | "warning" | "critical";

export interface OperationalSignal {
  id: string;
  type: string;
  domain: SignalDomain;
  severity: SignalSeverity;
  title: string;
  description: string;
  entityType?: string;
  entityId?: number;
  detectedAt: string;
  metadata: Record<string, unknown>;
}

export interface SignalSourceError {
  domain: SignalDomain;
  code: "SOURCE_UNAVAILABLE";
  message: string;
}

export interface DailyOperationsBrief {
  generatedAt: string;
  status: "ok" | "partial";
  errors: SignalSourceError[];
  summary: { critical: number; warning: number; attention: number; info: number };
  domains: Record<SignalDomain, OperationalSignal[]>;
}

export interface ProposeActionResult {
  plan: ActionPlan;
  items: ActionPlanItem[];
}

// Agentes v1.9 — Director Decision Queue (correio.md).
export const DECISION_STATUSES = [
  "open",
  "acknowledged",
  "action_planned",
  "awaiting_approval",
  "resolved",
  "dismissed",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export type DecisionImpact = "high" | "medium" | "low";
export type DecisionUrgency = "immediate" | "soon" | "normal";

export interface PriorityFactors {
  severity: { value: SignalSeverity; weight: number };
  impact: { value: DecisionImpact; weight: number };
  urgency: { value: DecisionUrgency; weight: number };
  aging: { days: number; weight: number };
  recurrence: { count: number; weight: number };
  total: number;
}

export interface DirectorDecision {
  id: number;
  deduplicationKey: string;
  signalType: string;
  domain: SignalDomain;
  entityType: string | null;
  entityId: number | null;
  title: string;
  description: string;
  severity: SignalSeverity;
  impact: DecisionImpact;
  urgency: DecisionUrgency;
  priorityScore: number;
  priorityFactors: PriorityFactors;
  status: DecisionStatus;
  requiresHumanAttention: boolean;
  firstDetectedAt: string;
  lastDetectedAt: string;
  occurrenceCount: number;
  resolvedAt: string | null;
  resolvedBy: number | null;
  actionPlanId: number | null;
  assignedUserId: number | null;
  acknowledgedAt: string | null;
  acknowledgedBy: number | null;
  dismissedAt: string | null;
  dismissedBy: number | null;
  dismissReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionQueueOverview {
  generatedAt: string;
  topCritical: DirectorDecision[];
  awaitingHumanAttention: DirectorDecision[];
  awaitingApproval: DirectorDecision[];
  agingOldestFirst: DirectorDecision[];
  mostRecurrent: DirectorDecision[];
  openTotal: number;
}

export interface DecisionSyncSummary {
  created: number;
  updated: number;
  resolved: number;
  unchanged: number;
  errors: { domain: SignalDomain; code: string; message: string }[];
}

// Agentes v2.0 — Director Goals, Initiatives & Executive Planning (correio.md).
export const GOAL_STATUSES = ["draft", "active", "paused", "achieved", "missed", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_HEALTHS = ["on_track", "attention", "at_risk", "critical", "unknown"] as const;
export type GoalHealth = (typeof GOAL_HEALTHS)[number];

export const GOAL_TARGET_TYPES = ["metric", "milestone"] as const;
export type GoalTargetType = (typeof GOAL_TARGET_TYPES)[number];

export const METRIC_DIRECTIONS = ["increase", "decrease", "maintain"] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const INITIATIVE_STATUSES = ["proposed", "approved", "active", "blocked", "completed", "cancelled"] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export type InitiativeOrigin = "manual" | "director_recommendation";
export type GoalPriority = "low" | "medium" | "high" | "critical";

export interface GoalHealthFactors {
  progressPercent: number;
  timeElapsedPercent: number;
  deviation: number;
  daysRemaining: number;
  isOverdue: boolean;
}

export interface DirectorGoal {
  id: number;
  title: string;
  description: string;
  domain: SignalDomain;
  status: GoalStatus;
  priority: GoalPriority;
  ownerUserId: number | null;
  createdBy: number;
  startDate: string;
  targetDate: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  targetType: GoalTargetType;
  targetValue: string | null;
  currentValue: string | null;
  unit: string | null;
  progressPercent: number;
  health: GoalHealth;
  lastEvaluatedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GoalMetric {
  id: number;
  goalId: number;
  metricKey: string;
  label: string;
  sourceDomain: SignalDomain;
  targetValue: string;
  currentValue: string | null;
  unit: string | null;
  direction: MetricDirection;
  weight: number;
  lastEvaluatedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GoalEvaluation {
  id: number;
  goalId: number;
  evaluatedAt: string;
  progressPercent: number;
  health: GoalHealth;
  metricSnapshot: {
    metricKey: string;
    currentValue: number;
    targetValue: number;
    direction: MetricDirection;
    weight: number;
    progressPercent: number;
  }[];
  factors: GoalHealthFactors;
  createdAt: string;
}

export interface DirectorInitiative {
  id: number;
  goalId: number;
  title: string;
  description: string;
  domain: SignalDomain;
  status: InitiativeStatus;
  priority: GoalPriority;
  rationale: string;
  expectedImpact: string | null;
  origin: InitiativeOrigin;
  recommendationKey: string | null;
  ownerUserId: number | null;
  createdBy: number | null;
  actionPlanId: number | null;
  startedAt: string | null;
  targetDate: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GoalDetail {
  goal: DirectorGoal;
  metrics: GoalMetric[];
  evaluations: GoalEvaluation[];
  initiatives: DirectorInitiative[];
}

export interface GoalsOverview {
  generatedAt: string;
  activeTotal: number;
  critical: DirectorGoal[];
  atRisk: DirectorGoal[];
  attention: DirectorGoal[];
  deadlineNear: DirectorGoal[];
  withoutOwner: DirectorGoal[];
}

export interface MetricCatalogEntry {
  key: string;
  domain: SignalDomain;
  label: string;
  unit: string;
  description: string;
  defaultDirection: MetricDirection;
}

// Agentes v2.1 — Initiative Execution & Progress Tracking (correio.md).
export const INITIATIVE_EXECUTION_STATES = ["not_started", "waiting_approval", "running", "blocked", "failed", "completed"] as const;
export type InitiativeExecutionState = (typeof INITIATIVE_EXECUTION_STATES)[number];

export interface InitiativeExecutionView {
  actionPlanId: number | null;
  state: InitiativeExecutionState;
  progressPercent: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  blockedItems: number;
  pendingApprovalItems: number;
  /** Agentes v2.1 — saneamento: itens `skipped` (decisão `shadow` — baixa confiança ou Shadow Mode), nunca contados como `blockedItems`. */
  shadowedItems: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface InitiativeExecutionDetail {
  initiative: DirectorInitiative;
  execution: InitiativeExecutionView;
}
