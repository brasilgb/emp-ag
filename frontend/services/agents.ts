import type { Paginated } from "@/types/shared";
import type {
  ActionPlan,
  ActionPlanDetail,
  ActionPlanItem,
  ActionPlanStatus,
  Agent,
  AgentApproval,
  AgentResponsibility,
  AgentConversation,
  AgentConversationDetail,
  AgentEvent,
  AgentEventDetail,
  AgentEventRule,
  AgentExecution,
  AgentJob,
  AgentJobRun,
  AgentTool,
  AgentToolForAgent,
  ApprovalStatus,
  AuditLogEntry,
  ChatResponse,
  DecisionQueueOverview,
  DecisionStatus,
  DecisionSyncSummary,
  DirectorDecision,
  DirectorGoal,
  DirectorInitiative,
  EscalationSeverity,
  EscalationStatus,
  EscalationPolicy,
  EventCatalogEntry,
  EventFilters,
  EventStatus,
  ExecutionStatus,
  ExecutiveReview,
  FollowUpPriority,
  FollowUpStatus,
  MemoryStatus,
  MemoryType,
  OperationalEscalation,
  OperationalFollowUp,
  OperationalHealth,
  OperationalIncident,
  OperationalSupervisionReport,
  OperationalSupervisionSchedulerStatus,
  RecoveryItemResult,
  RecoveryReport,
  RecoveryStatus,
  StaleCandidate,
  StrategicMemory,
  WorkflowType,
  GlobalAutonomyState,
  GoalDetail,
  GoalHealth,
  GoalMetric,
  GoalPriority,
  GoalStatus,
  GoalsOverview,
  GoalTargetType,
  HumanVerdict,
  Incident,
  IncidentType,
  InitiativeExecutionDetail,
  InitiativeStatus,
  InterpreterStats,
  JobRunLineage,
  JobRunStatus,
  JobRunDetail,
  JobStatus,
  DailyOperationsBrief,
  JobTriggerType,
  MetricCatalogEntry,
  MetricDirection,
  OperationalSignal,
  ResponsibilityPriority,
  ResponsibilityType,
  OperationsSummary,
  ProposeActionResult,
  ResolvedSetting,
  ScheduleConfig,
  SettingKey,
  SignalDomain,
  SignalSeverity,
  SignalSourceError,
} from "@/types/agents";

import { apiFetch, toQueryString } from "./http";

export interface ExecuteToolInput {
  agentSlug: string;
  toolHandler: string;
  input?: Record<string, unknown>;
  conversationId?: number;
  idempotencyKey?: string;
}

export interface ExecuteToolResponse {
  status: "completed" | "waiting_approval";
  executionId: number;
  approvalId?: number;
  idempotentReplay?: boolean;
  result?: { success: boolean; summary: string; data: unknown; metadata?: Record<string, unknown> };
  message?: string;
}

export interface ListExecutionsParams {
  page?: number;
  limit?: number;
  status?: ExecutionStatus;
  agentId?: number;
}

export interface ListApprovalsParams {
  page?: number;
  limit?: number;
  status?: ApprovalStatus;
}

export function listAgents(): Promise<{ data: Agent[] }> {
  return apiFetch("/api/agents");
}

export function getAgent(id: number): Promise<{ data: Agent }> {
  return apiFetch(`/api/agents/${id}`);
}

export function listAgentTools(params: { department?: string } = {}): Promise<{ data: AgentTool[] }> {
  return apiFetch(`/api/agents/tools${toQueryString({ ...params })}`);
}

export function getAgentTools(agentId: number): Promise<{ data: AgentToolForAgent[] }> {
  return apiFetch(`/api/agents/${agentId}/tools`);
}

export function executeTool(input: ExecuteToolInput): Promise<ExecuteToolResponse> {
  return apiFetch("/api/agents/execute", { method: "POST", body: JSON.stringify(input) });
}

export function listExecutions(params: ListExecutionsParams = {}): Promise<Paginated<AgentExecution>> {
  return apiFetch(`/api/agents/executions${toQueryString({ ...params })}`);
}

export function getExecution(id: number): Promise<{ data: AgentExecution }> {
  return apiFetch(`/api/agents/executions/${id}`);
}

export function listApprovals(params: ListApprovalsParams = {}): Promise<Paginated<AgentApproval>> {
  return apiFetch(`/api/agents/approvals${toQueryString({ ...params })}`);
}

export function approveApproval(id: number, note?: string): Promise<unknown> {
  return apiFetch(`/api/agents/approvals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function rejectApproval(id: number, note?: string): Promise<unknown> {
  return apiFetch(`/api/agents/approvals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function listConversations(
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<AgentConversation>> {
  return apiFetch(`/api/agents/conversations${toQueryString({ ...params })}`);
}

export function createConversation(title?: string): Promise<{ data: AgentConversation }> {
  return apiFetch("/api/agents/conversations", { method: "POST", body: JSON.stringify({ title }) });
}

export function getConversation(id: number): Promise<{ data: AgentConversationDetail }> {
  return apiFetch(`/api/agents/conversations/${id}`);
}

export function sendChatMessage(input: { conversationId?: number; message: string }): Promise<ChatResponse> {
  return apiFetch("/api/agents/chat", { method: "POST", body: JSON.stringify(input) });
}

// Agentes v1.2 — Action Planning + Approval Workflow (correio.md).
export interface ListActionPlansParams {
  page?: number;
  limit?: number;
  status?: ActionPlanStatus;
}

export function listActionPlans(params: ListActionPlansParams = {}): Promise<Paginated<ActionPlan>> {
  return apiFetch(`/api/agents/action-plans${toQueryString({ ...params })}`);
}

export function getActionPlan(id: number): Promise<{ data: ActionPlanDetail }> {
  return apiFetch(`/api/agents/action-plans/${id}`);
}

export function createActionPlan(objective: string): Promise<{ data: ActionPlanDetail }> {
  return apiFetch("/api/agents/action-plans", { method: "POST", body: JSON.stringify({ objective }) });
}

// Agentes v1.3 — Jobs, Runs, Delegation & Controlled Autonomy (correio.md).
export interface ListJobsParams {
  page?: number;
  limit?: number;
  status?: JobStatus;
}

export interface CreateJobInput {
  name: string;
  description?: string;
  objective: string;
  agentSlug: string;
  triggerType: JobTriggerType;
  scheduleConfig?: ScheduleConfig;
  shadowMode?: boolean;
  allowConcurrentRuns?: boolean;
  maxRunsPerDay?: number;
  maxActionsPerRun?: number;
  maxOpenApprovals?: number;
  timeoutSeconds?: number;
}

export function listJobs(params: ListJobsParams = {}): Promise<Paginated<AgentJob>> {
  return apiFetch(`/api/agents/jobs${toQueryString({ ...params })}`);
}

export function getJob(id: number): Promise<{ data: AgentJob }> {
  return apiFetch(`/api/agents/jobs/${id}`);
}

export function createJob(input: CreateJobInput): Promise<{ data: AgentJob }> {
  return apiFetch("/api/agents/jobs", { method: "POST", body: JSON.stringify(input) });
}

export function runJob(id: number): Promise<{ data: AgentJobRun }> {
  return apiFetch(`/api/agents/jobs/${id}/run`, { method: "POST", body: JSON.stringify({}) });
}

export function pauseJob(id: number): Promise<{ data: AgentJob }> {
  return apiFetch(`/api/agents/jobs/${id}/pause`, { method: "POST", body: JSON.stringify({}) });
}

export function resumeJob(id: number): Promise<{ data: AgentJob }> {
  return apiFetch(`/api/agents/jobs/${id}/resume`, { method: "POST", body: JSON.stringify({}) });
}

export function cancelJob(id: number): Promise<{ data: AgentJob }> {
  return apiFetch(`/api/agents/jobs/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
}

// Agentes v1.5 — Granular Autonomy Switch, exposto ao frontend só na
// v1.6 (correio.md v1.6 seção 7/8: o endpoint já existia no backend
// desde a v1.5, sem UI até agora).
export function setJobAutonomy(id: number, enabled: boolean): Promise<{ data: AgentJob }> {
  return apiFetch(`/api/agents/jobs/${id}/autonomy`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}

export function listJobRuns(
  jobId: number,
  params: { page?: number; limit?: number; status?: JobRunStatus } = {},
): Promise<Paginated<AgentJobRun>> {
  return apiFetch(`/api/agents/jobs/${jobId}/runs${toQueryString({ ...params })}`);
}

export function getJobRun(id: number): Promise<{ data: AgentJobRun }> {
  return apiFetch(`/api/agents/job-runs/${id}`);
}

// v1.1 — LLM Interpreter + Shadow Mode (seção 27/28).
export function getInterpreterStats(): Promise<InterpreterStats> {
  return apiFetch("/api/agents/interpreter/stats");
}

// Seção 30 — feedback humano sobre uma interpretação. Nunca altera
// prompt/router/model; é só avaliação (agent.executions.manage).
export function reviewInterpretation(id: number, verdict: HumanVerdict): Promise<unknown> {
  return apiFetch(`/api/agents/interpreter/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ verdict }),
  });
}

// Agentes v1.4 — Event Engine & Autonomous Operations (correio.md).
export interface ListEventsParams {
  page?: number;
  limit?: number;
  status?: EventStatus;
  eventType?: string;
}

export function listEvents(params: ListEventsParams = {}): Promise<Paginated<AgentEvent>> {
  return apiFetch(`/api/agents/events${toQueryString({ ...params })}`);
}

export function getEvent(id: number): Promise<{ data: AgentEventDetail }> {
  return apiFetch(`/api/agents/events/${id}`);
}

export function retryEvent(id: number): Promise<{ data: AgentEvent }> {
  return apiFetch(`/api/agents/events/${id}/retry`, { method: "POST", body: JSON.stringify({}) });
}

export function getEventCatalog(): Promise<{ data: EventCatalogEntry[] }> {
  return apiFetch("/api/agents/events/catalog");
}

export interface ListEventRulesParams {
  page?: number;
  limit?: number;
  eventType?: string;
  jobId?: number;
  enabled?: boolean;
}

export interface CreateEventRuleInput {
  name: string;
  description?: string;
  eventType: string;
  jobId: number;
  filters: EventFilters;
  enabled?: boolean;
}

export interface UpdateEventRuleInput {
  name?: string;
  description?: string;
  filters?: EventFilters;
  enabled?: boolean;
}

export function listEventRules(params: ListEventRulesParams = {}): Promise<Paginated<AgentEventRule>> {
  return apiFetch(`/api/agents/event-rules${toQueryString({ ...params })}`);
}

export function getEventRule(id: number): Promise<{ data: AgentEventRule }> {
  return apiFetch(`/api/agents/event-rules/${id}`);
}

export function createEventRule(input: CreateEventRuleInput): Promise<{ data: AgentEventRule }> {
  return apiFetch("/api/agents/event-rules", { method: "POST", body: JSON.stringify(input) });
}

export function updateEventRule(id: number, input: UpdateEventRuleInput): Promise<{ data: AgentEventRule }> {
  return apiFetch(`/api/agents/event-rules/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteEventRule(id: number): Promise<unknown> {
  return apiFetch(`/api/agents/event-rules/${id}`, { method: "DELETE" });
}

// Agentes v1.6 — Operations Control & Observability (correio.md).

export function getJobRunDetail(id: number): Promise<{ data: JobRunDetail }> {
  return apiFetch(`/api/agents/job-runs/${id}/detail`);
}

export function getJobRunLineage(id: number): Promise<{ data: JobRunLineage }> {
  return apiFetch(`/api/agents/job-runs/${id}/lineage`);
}

export interface OperationsSummaryParams {
  from?: string;
  to?: string;
}

export function getOperationsSummary(params: OperationsSummaryParams = {}): Promise<{ data: OperationsSummary }> {
  return apiFetch(`/api/agents/operations/summary${toQueryString({ ...params })}`);
}

export interface ListIncidentsParams {
  page?: number;
  limit?: number;
  type?: IncidentType;
  jobId?: number;
  from?: string;
  to?: string;
}

export function listIncidents(params: ListIncidentsParams = {}): Promise<Paginated<Incident>> {
  return apiFetch(`/api/agents/incidents${toQueryString({ ...params })}`);
}

export interface ListAuditLogsParams {
  page?: number;
  limit?: number;
  action?: string;
  userId?: number;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
}

export function listAuditLogs(params: ListAuditLogsParams = {}): Promise<Paginated<AuditLogEntry>> {
  return apiFetch(`/api/agents/audit-logs${toQueryString({ ...params })}`);
}

export function getGlobalAutonomy(): Promise<{ data: GlobalAutonomyState }> {
  return apiFetch("/api/agents/autonomy");
}

export function setGlobalAutonomy(enabled: boolean): Promise<{ data: GlobalAutonomyState }> {
  return apiFetch("/api/agents/autonomy", { method: "PATCH", body: JSON.stringify({ enabled }) });
}

// Agentes v1.7 — Agent Management & Operational Configuration (correio.md).

export function listSettings(): Promise<{ data: ResolvedSetting[] }> {
  return apiFetch("/api/agents/settings");
}

export function setSetting(key: SettingKey, value: number): Promise<{ data: ResolvedSetting }> {
  return apiFetch(`/api/agents/settings/${key}`, { method: "PATCH", body: JSON.stringify({ value }) });
}

export function deleteSetting(key: SettingKey): Promise<{ data: ResolvedSetting }> {
  return apiFetch(`/api/agents/settings/${key}`, { method: "DELETE" });
}

export function listJobSettings(jobId: number): Promise<{ data: ResolvedSetting[] }> {
  return apiFetch(`/api/agents/jobs/${jobId}/settings`);
}

export function setJobSetting(jobId: number, key: SettingKey, value: number): Promise<{ data: ResolvedSetting }> {
  return apiFetch(`/api/agents/jobs/${jobId}/settings/${key}`, { method: "PATCH", body: JSON.stringify({ value }) });
}

export function deleteJobSetting(jobId: number, key: SettingKey): Promise<{ data: ResolvedSetting }> {
  return apiFetch(`/api/agents/jobs/${jobId}/settings/${key}`, { method: "DELETE" });
}

// Agentes v1.8 — Director Operations & Business Workflows (correio.md).

export function getDirectorBrief(): Promise<{ data: DailyOperationsBrief }> {
  return apiFetch("/api/agents/director/brief");
}

export function listDirectorSignals(): Promise<{ data: OperationalSignal[]; errors: SignalSourceError[] }> {
  return apiFetch("/api/agents/director/signals");
}

export function getDirectorSignal(id: string): Promise<{ data: OperationalSignal }> {
  return apiFetch(`/api/agents/director/signals/${encodeURIComponent(id)}`);
}

export function proposeSignalAction(id: string): Promise<{ data: ProposeActionResult }> {
  return apiFetch(`/api/agents/director/signals/${encodeURIComponent(id)}/propose`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// Agentes v1.9 — Director Decision Queue (correio.md).
export interface ListDecisionsParams {
  page?: number;
  limit?: number;
  status?: DecisionStatus;
  domain?: SignalDomain;
  severity?: SignalSeverity;
  assignedUserId?: number;
  requiresHumanAttention?: boolean;
}

export function listDirectorDecisions(params: ListDecisionsParams = {}): Promise<Paginated<DirectorDecision>> {
  return apiFetch(`/api/agents/director/decisions${toQueryString({ ...params })}`);
}

export function getDirectorDecisionsOverview(): Promise<{ data: DecisionQueueOverview }> {
  return apiFetch("/api/agents/director/decisions/overview");
}

export interface DirectorDecisionDetail {
  decision: DirectorDecision;
  pendingApproval: AgentApproval | null;
}

export function getDirectorDecision(id: number): Promise<{ data: DirectorDecisionDetail }> {
  return apiFetch(`/api/agents/director/decisions/${id}`);
}

export function syncDirectorDecisionQueue(): Promise<{ data: DecisionSyncSummary }> {
  return apiFetch("/api/agents/director/decisions/sync", { method: "POST", body: JSON.stringify({}) });
}

export function acknowledgeDecision(id: number): Promise<{ data: DirectorDecision }> {
  return apiFetch(`/api/agents/director/decisions/${id}/acknowledge`, { method: "POST", body: JSON.stringify({}) });
}

export function assignDecision(id: number, userId: number): Promise<{ data: DirectorDecision }> {
  return apiFetch(`/api/agents/director/decisions/${id}/assign`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export function dismissDecision(id: number, reason: string): Promise<{ data: DirectorDecision }> {
  return apiFetch(`/api/agents/director/decisions/${id}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function proposeDecisionAction(
  id: number,
): Promise<{ data: { decision: DirectorDecision; plan: ActionPlan; items: ActionPlanItem[] } }> {
  return apiFetch(`/api/agents/director/decisions/${id}/propose`, { method: "POST", body: JSON.stringify({}) });
}

// Agentes v2.0 — Director Goals, Initiatives & Executive Planning (correio.md).
export interface ListGoalsParams {
  page?: number;
  limit?: number;
  status?: GoalStatus;
  domain?: SignalDomain;
  health?: GoalHealth;
  ownerUserId?: number;
}

export function listDirectorGoals(params: ListGoalsParams = {}): Promise<Paginated<DirectorGoal>> {
  return apiFetch(`/api/agents/director/goals${toQueryString({ ...params })}`);
}

export function getDirectorGoalsOverview(): Promise<{ data: GoalsOverview }> {
  return apiFetch("/api/agents/director/goals/overview");
}

export function getGoalMetricCatalog(): Promise<{ data: MetricCatalogEntry[] }> {
  return apiFetch("/api/agents/director/goals/metrics/catalog");
}

export interface CreateGoalInput {
  title: string;
  description: string;
  domain: SignalDomain;
  priority?: GoalPriority;
  ownerUserId?: number;
  startDate: string;
  targetDate: string;
  targetType?: GoalTargetType;
  targetValue?: number;
  unit?: string;
}

export function createDirectorGoal(input: CreateGoalInput): Promise<{ data: DirectorGoal }> {
  return apiFetch("/api/agents/director/goals", { method: "POST", body: JSON.stringify(input) });
}

export function getDirectorGoal(id: number): Promise<{ data: GoalDetail }> {
  return apiFetch(`/api/agents/director/goals/${id}`);
}

export interface UpdateGoalInput {
  title?: string;
  description?: string;
  priority?: GoalPriority;
  ownerUserId?: number | null;
  targetDate?: string;
  targetValue?: number | null;
  currentValue?: number | null;
  unit?: string | null;
}

export function updateDirectorGoal(id: number, input: UpdateGoalInput): Promise<{ data: DirectorGoal }> {
  return apiFetch(`/api/agents/director/goals/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function activateDirectorGoal(id: number): Promise<{ data: DirectorGoal }> {
  return apiFetch(`/api/agents/director/goals/${id}/activate`, { method: "POST", body: JSON.stringify({}) });
}

export function pauseDirectorGoal(id: number): Promise<{ data: DirectorGoal }> {
  return apiFetch(`/api/agents/director/goals/${id}/pause`, { method: "POST", body: JSON.stringify({}) });
}

export function cancelDirectorGoal(id: number, reason: string): Promise<{ data: DirectorGoal }> {
  return apiFetch(`/api/agents/director/goals/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function evaluateDirectorGoal(id: number): Promise<{ data: { goal: DirectorGoal; evaluation: unknown } }> {
  return apiFetch(`/api/agents/director/goals/${id}/evaluate`, { method: "POST", body: JSON.stringify({}) });
}

export function addGoalMetric(
  goalId: number,
  input: { metricKey: string; targetValue: number; weight?: number; direction?: MetricDirection },
): Promise<{ data: GoalMetric }> {
  return apiFetch(`/api/agents/director/goals/${goalId}/metrics`, { method: "POST", body: JSON.stringify(input) });
}

export interface ListInitiativesParams {
  page?: number;
  limit?: number;
  goalId?: number;
  status?: InitiativeStatus;
}

export function listDirectorInitiatives(params: ListInitiativesParams = {}): Promise<Paginated<DirectorInitiative>> {
  return apiFetch(`/api/agents/director/initiatives${toQueryString({ ...params })}`);
}

export interface DirectorInitiativeDetail {
  initiative: DirectorInitiative;
  pendingApproval: AgentApproval | null;
}

export function getDirectorInitiative(id: number): Promise<{ data: DirectorInitiativeDetail }> {
  return apiFetch(`/api/agents/director/initiatives/${id}`);
}

// Agentes v2.1 — Initiative Execution & Progress Tracking (correio.md).
export function getInitiativeExecution(id: number): Promise<{ data: InitiativeExecutionDetail }> {
  return apiFetch(`/api/agents/director/initiatives/${id}/execution`);
}

export interface CreateInitiativeInput {
  title: string;
  description: string;
  domain: SignalDomain;
  priority?: GoalPriority;
  rationale: string;
  expectedImpact?: string;
  ownerUserId?: number;
  targetDate?: string;
}

export function createDirectorInitiative(goalId: number, input: CreateInitiativeInput): Promise<{ data: DirectorInitiative }> {
  return apiFetch(`/api/agents/director/goals/${goalId}/initiatives`, { method: "POST", body: JSON.stringify(input) });
}

export function approveDirectorInitiative(id: number): Promise<{ data: DirectorInitiative }> {
  return apiFetch(`/api/agents/director/initiatives/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
}

export function cancelDirectorInitiative(id: number, reason: string): Promise<{ data: DirectorInitiative }> {
  return apiFetch(`/api/agents/director/initiatives/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function completeDirectorInitiative(id: number): Promise<{ data: DirectorInitiative }> {
  return apiFetch(`/api/agents/director/initiatives/${id}/complete`, { method: "POST", body: JSON.stringify({}) });
}

export function proposeInitiativeAction(
  id: number,
): Promise<{ data: { initiative: DirectorInitiative; plan: ActionPlan; items: ActionPlanItem[]; created: boolean } }> {
  return apiFetch(`/api/agents/director/initiatives/${id}/propose`, { method: "POST", body: JSON.stringify({}) });
}

// Agentes v2.2 — Executive Review & Strategic Feedback Loop (correio.md).
// `data: null` quando ainda não existe review completada — nunca 404.
export function getInitiativeReview(id: number): Promise<{ data: ExecutiveReview | null }> {
  return apiFetch(`/api/agents/director/initiatives/${id}/review`);
}

export function generateInitiativeReview(id: number): Promise<{ data: ExecutiveReview }> {
  return apiFetch(`/api/agents/director/initiatives/${id}/review`, { method: "POST", body: JSON.stringify({}) });
}

// Agentes v2.3 — Strategic Learning & Organizational Memory (correio.md).
export interface ListStrategicMemoriesParams {
  page?: number;
  limit?: number;
  domain?: SignalDomain;
  memoryType?: MemoryType;
  status?: MemoryStatus;
  goalId?: number;
  initiativeId?: number;
}

export function listStrategicMemories(params: ListStrategicMemoriesParams = {}): Promise<Paginated<StrategicMemory>> {
  return apiFetch(`/api/agents/director/memories${toQueryString({ ...params })}`);
}

export function getStrategicMemory(id: number): Promise<{ data: StrategicMemory }> {
  return apiFetch(`/api/agents/director/memories/${id}`);
}

export function generateMemoryFromReview(reviewId: number): Promise<{ data: StrategicMemory }> {
  return apiFetch(`/api/agents/director/reviews/${reviewId}/memory`, { method: "POST", body: JSON.stringify({}) });
}

// Agentes v2.4 — Workflow Recovery, Reconciliation & Operational Resilience (correio.md).
export function getRecoveryStatus(): Promise<{ data: RecoveryStatus }> {
  return apiFetch(`/api/agents/recovery/status`);
}

export function getStaleWorkflows(): Promise<{ data: StaleCandidate[]; errors: { workflowType: string; message: string }[] }> {
  return apiFetch(`/api/agents/recovery/stale`);
}

export function runWorkflowRecovery(dryRun: boolean): Promise<{ data: RecoveryReport }> {
  return apiFetch(`/api/agents/recovery/run${toQueryString({ dryRun })}`, { method: "POST", body: JSON.stringify({}) });
}

export function reconcileWorkflow(
  type: WorkflowType,
  id: number,
  dryRun: boolean,
): Promise<{ data: RecoveryItemResult }> {
  return apiFetch(`/api/agents/recovery/${type}/${id}${toQueryString({ dryRun })}`, { method: "POST", body: JSON.stringify({}) });
}

// Agentes v2.5 — Operational Supervision & Autonomous Incident Response (correio.md).
export function getOperationalHealth(): Promise<{ data: OperationalHealth }> {
  return apiFetch(`/api/agents/operations/health`);
}

export function getOperationalIncidents(): Promise<{ data: OperationalIncident[] }> {
  return apiFetch(`/api/agents/operations/incidents`);
}

export function runOperationalSupervision(dryRun: boolean): Promise<{ data: OperationalSupervisionReport }> {
  return apiFetch(`/api/agents/operations/supervise${toQueryString({ dryRun })}`, { method: "POST", body: JSON.stringify({}) });
}

// Agentes v2.5.1 — Automatic Operational Supervision (correio.md).
export function getOperationalSupervisionSchedulerStatus(): Promise<{ data: OperationalSupervisionSchedulerStatus }> {
  return apiFetch(`/api/agents/operations/scheduler`);
}

export function setOperationalSupervisionSchedulerEnabled(enabled: boolean): Promise<{ data: OperationalSupervisionSchedulerStatus }> {
  return apiFetch(`/api/agents/operations/scheduler`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}

// Agentes v2.6 — Agent Responsibilities, Operational Ownership & Escalation (correio.md).
export interface ListResponsibilitiesParams {
  page?: number;
  limit?: number;
  agentId?: number;
  domain?: SignalDomain;
  responsibilityType?: ResponsibilityType;
  enabled?: boolean;
}

export function listResponsibilities(params: ListResponsibilitiesParams = {}): Promise<Paginated<AgentResponsibility>> {
  return apiFetch(`/api/agents/responsibilities${toQueryString({ ...params })}`);
}

export function getResponsibility(id: number): Promise<{ data: AgentResponsibility }> {
  return apiFetch(`/api/agents/responsibilities/${id}`);
}

export interface CreateResponsibilityInput {
  agentId: number;
  name: string;
  description?: string;
  domain: SignalDomain;
  responsibilityType: ResponsibilityType;
  priority?: ResponsibilityPriority;
  conditions?: Record<string, unknown>;
  escalationPolicy?: EscalationPolicy;
  escalationTargetAgentId?: number;
  escalationTargetUserId?: number;
}

export function createResponsibility(input: CreateResponsibilityInput): Promise<{ data: AgentResponsibility }> {
  return apiFetch(`/api/agents/responsibilities`, { method: "POST", body: JSON.stringify(input) });
}

export interface UpdateResponsibilityInput {
  name?: string;
  description?: string | null;
  priority?: ResponsibilityPriority;
  conditions?: Record<string, unknown>;
  enabled?: boolean;
  escalationPolicy?: EscalationPolicy;
  escalationTargetAgentId?: number | null;
  escalationTargetUserId?: number | null;
}

export function updateResponsibility(id: number, input: UpdateResponsibilityInput): Promise<{ data: AgentResponsibility }> {
  return apiFetch(`/api/agents/responsibilities/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteResponsibility(id: number): Promise<void> {
  return apiFetch(`/api/agents/responsibilities/${id}`, { method: "DELETE" });
}

export interface ListEscalationsParams {
  page?: number;
  limit?: number;
  status?: EscalationStatus;
  severity?: EscalationSeverity;
  responsibilityId?: number;
  targetAgentId?: number;
  targetUserId?: number;
}

export function listEscalations(params: ListEscalationsParams = {}): Promise<Paginated<OperationalEscalation>> {
  return apiFetch(`/api/agents/escalations${toQueryString({ ...params })}`);
}

export function getEscalation(id: number): Promise<{ data: OperationalEscalation }> {
  return apiFetch(`/api/agents/escalations/${id}`);
}

export function acknowledgeEscalation(id: number): Promise<{ data: OperationalEscalation }> {
  return apiFetch(`/api/agents/escalations/${id}/acknowledge`, { method: "POST", body: JSON.stringify({}) });
}

export function resolveEscalation(id: number): Promise<{ data: OperationalEscalation }> {
  return apiFetch(`/api/agents/escalations/${id}/resolve`, { method: "POST", body: JSON.stringify({}) });
}

export function dismissEscalation(id: number, reason: string): Promise<{ data: OperationalEscalation }> {
  return apiFetch(`/api/agents/escalations/${id}/dismiss`, { method: "POST", body: JSON.stringify({ reason }) });
}

// Agentes v2.7 — Operational Follow-up & Coordinated Workflows (correio.md).
export interface ListFollowUpsParams {
  page?: number;
  limit?: number;
  status?: FollowUpStatus;
  priority?: FollowUpPriority;
  ownerAgentId?: number;
  assignedUserId?: number;
  responsibilityId?: number;
  escalationId?: number;
  overdue?: boolean;
}

export function listFollowUps(params: ListFollowUpsParams = {}): Promise<Paginated<OperationalFollowUp>> {
  return apiFetch(`/api/agents/follow-ups${toQueryString({ ...params })}`);
}

export function getFollowUp(id: number): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups/${id}`);
}

export interface CreateManualFollowUpInput {
  responsibilityId: number;
  title: string;
  description?: string;
  priority?: FollowUpPriority;
  assignedUserId?: number;
  dueAt?: string;
  nextReviewAt?: string;
}

export function createManualFollowUp(input: CreateManualFollowUpInput): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups`, { method: "POST", body: JSON.stringify(input) });
}

export function startFollowUp(id: number): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups/${id}/start`, { method: "POST", body: JSON.stringify({}) });
}

export function waitFollowUp(id: number, waitingReason: string, waitingUntil?: string): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups/${id}/wait`, { method: "POST", body: JSON.stringify({ waitingReason, waitingUntil }) });
}

export function resumeFollowUp(id: number): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups/${id}/resume`, { method: "POST", body: JSON.stringify({}) });
}

export function completeFollowUp(id: number, resolution: string): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups/${id}/complete`, { method: "POST", body: JSON.stringify({ resolution }) });
}

export function dismissFollowUp(id: number, reason: string): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups/${id}/dismiss`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function reassignFollowUp(id: number, assignedUserId: number | null): Promise<{ data: OperationalFollowUp }> {
  return apiFetch(`/api/agents/follow-ups/${id}/reassign`, { method: "POST", body: JSON.stringify({ assignedUserId }) });
}
