import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  actionDecisionLabel,
  actionPlanItemStatusLabel,
  actionPlanStatusLabel,
  actionRiskLabel,
  approvalStateLabel,
  autonomyBlockReasonLabel,
  autonomyLevelBadgeVariant,
  autonomyLevelLabel,
  circuitStateLabel,
  actionProposalStatusLabel,
  decisionStatusLabel,
  escalationSeverityLabel,
  escalationStatusLabel,
  eventDeliveryStatusLabel,
  followUpStatusLabel,
  eventStatusLabel,
  executionStatusLabel,
  goalHealthLabel,
  goalStatusLabel,
  humanVerdictLabel,
  incidentTypeLabel,
  initiativeExecutionStateLabel,
  initiativeStatusLabel,
  interpretationCategoryLabel,
  interpretationErrorTypeLabel,
  jobRunStatusLabel,
  jobStatusLabel,
  memoryImportanceLabel,
  memoryStatusLabel,
  operationalHealthStatusLabel,
  operationalIncidentTypeLabel,
  operationalResponseLabel,
  operationalSeverityLabel,
  recommendationTypeLabel,
  recoveryResultLabel,
  reviewOutcomeLabel,
  signalSeverityLabel,
  type DerivedApprovalState,
} from "@/lib/agents/derived";
import type {
  ActionDecision,
  ActionPlanItemStatus,
  ActionPlanStatus,
  ActionRisk,
  AutonomyBlockReason,
  AutonomyLevel,
  CircuitState,
  ActionProposalStatus,
  DecisionStatus,
  EscalationSeverity,
  EscalationStatus,
  EventDeliveryStatus,
  EventStatus,
  FollowUpStatus,
  ExecutionStatus,
  GoalHealth,
  GoalStatus,
  HumanVerdict,
  IncidentType,
  InitiativeExecutionState,
  InitiativeStatus,
  InterpretationCategory,
  InterpretationError,
  JobRunStatus,
  JobStatus,
  MemoryImportance,
  MemoryStatus,
  OperationalHealthStatus,
  OperationalIncidentType,
  OperationalResponse,
  OperationalSeverity,
  RecommendationType,
  RecoveryResult,
  ReviewOutcome,
  SignalSeverity,
} from "@/types/agents";

const EXECUTION_STATUS_STYLES: Record<ExecutionStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  waiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", EXECUTION_STATUS_STYLES[status])}>
      {executionStatusLabel(status)}
    </Badge>
  );
}

export function AutonomyBadge({ level }: { level: AutonomyLevel }) {
  return <Badge variant={autonomyLevelBadgeVariant(level)}>{autonomyLevelLabel(level)}</Badge>;
}

const APPROVAL_STATE_STYLES: Record<DerivedApprovalState, string> = {
  pending: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  expiring_soon: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  expired: "bg-muted text-muted-foreground",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

export function ApprovalStateBadge({ state }: { state: DerivedApprovalState }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", APPROVAL_STATE_STYLES[state])}>
      {approvalStateLabel(state)}
    </Badge>
  );
}

// Seção 29/30/30-bis — nunca deixar deterministic_unknown_llm_recognized
// com a mesma cor de mismatch: é o caso que mais interessa destacar, não
// um erro. both_unknown fica neutro (cinza) — não é uma "concordância"
// (verde) nem uma divergência real (vermelho).
const INTERPRETATION_CATEGORY_STYLES: Record<InterpretationCategory, string> = {
  match: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  mismatch: "bg-red-500/10 text-red-700 dark:text-red-400",
  deterministic_unknown_llm_recognized: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  both_unknown: "bg-muted text-muted-foreground",
};

export function InterpretationCategoryBadge({ category }: { category: InterpretationCategory | null }) {
  if (!category) {
    return (
      <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">
        {interpretationCategoryLabel(category)}
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className={cn("border-transparent", INTERPRETATION_CATEGORY_STYLES[category])}>
      {interpretationCategoryLabel(category)}
    </Badge>
  );
}

const HUMAN_VERDICT_STYLES: Record<HumanVerdict, string> = {
  correct: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  incorrect: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function HumanVerdictBadge({ verdict }: { verdict: HumanVerdict | null }) {
  const label = humanVerdictLabel(verdict);
  if (!verdict || !label) return null;

  return (
    <Badge variant="secondary" className={cn("border-transparent", HUMAN_VERDICT_STYLES[verdict])}>
      {label}
    </Badge>
  );
}

// Seção 30-bis — low_confidence/clarification são resultados válidos do
// modelo, não falhas: badge âmbar (atenção), não vermelho (erro real).
// `error` já vem sanitizado do backend (nunca API key/headers/
// credenciais) — este componente só formata o que já chegou seguro.
function isSoftOutcome(type: InterpretationError["type"]): boolean {
  return type === "low_confidence" || type === "clarification";
}

export function InterpretationErrorBadge({ error }: { error: InterpretationError | null }) {
  if (!error) return null;

  const label = interpretationErrorTypeLabel(error.type);
  const style = isSoftOutcome(error.type)
    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
    : "bg-red-500/10 text-red-700 dark:text-red-400";

  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge variant="secondary" className={cn("border-transparent", style)}>
        {label}
        {error.statusCode ? ` (${error.statusCode})` : ""}
      </Badge>
      {error.message ? (
        <span className="max-w-56 truncate text-[11px] text-muted-foreground" title={error.message}>
          {error.message}
        </span>
      ) : null}
    </div>
  );
}

// Agentes v1.2 — Action Planning + Approval Workflow (correio.md).
const ACTION_PLAN_STATUS_STYLES: Record<ActionPlanStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  evaluating: "bg-muted text-muted-foreground",
  waiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  executing: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  partial: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

export function ActionPlanStatusBadge({ status }: { status: ActionPlanStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ACTION_PLAN_STATUS_STYLES[status])}>
      {actionPlanStatusLabel(status)}
    </Badge>
  );
}

const ACTION_PLAN_ITEM_STATUS_STYLES: Record<ActionPlanItemStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  waiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  executing: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  blocked: "bg-red-500/10 text-red-700 dark:text-red-400",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400",
  skipped: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

export function ActionPlanItemStatusBadge({ status }: { status: ActionPlanItemStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ACTION_PLAN_ITEM_STATUS_STYLES[status])}>
      {actionPlanItemStatusLabel(status)}
    </Badge>
  );
}

const ACTION_RISK_STYLES: Record<ActionRisk, string> = {
  read: "bg-muted text-muted-foreground",
  low: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  high: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function ActionRiskBadge({ risk }: { risk: ActionRisk }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ACTION_RISK_STYLES[risk])}>
      {actionRiskLabel(risk)}
    </Badge>
  );
}

// approval_required é sempre o mais destacado (âmbar) — mesmo princípio de
// autonomyLevelBadgeVariant acima: nunca deve passar despercebido.
const ACTION_DECISION_STYLES: Record<ActionDecision, string> = {
  execute: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  approval_required: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  blocked: "bg-red-500/10 text-red-700 dark:text-red-400",
  shadow: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

export function ActionDecisionBadge({ decision }: { decision: ActionDecision }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ACTION_DECISION_STYLES[decision])}>
      {actionDecisionLabel(decision)}
    </Badge>
  );
}

// Agentes v1.3 — Jobs, Runs, Delegation & Controlled Autonomy (correio.md).
const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", JOB_STATUS_STYLES[status])}>
      {jobStatusLabel(status)}
    </Badge>
  );
}

const JOB_RUN_STATUS_STYLES: Record<JobRunStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  planning: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  waiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  partial: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
  blocked: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function JobRunStatusBadge({ status }: { status: JobRunStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", JOB_RUN_STATUS_STYLES[status])}>
      {jobRunStatusLabel(status)}
    </Badge>
  );
}

// Agentes v1.4 — Event Engine & Autonomous Operations (correio.md).
const EVENT_STATUS_STYLES: Record<EventStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  processing: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  processed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  ignored: "bg-muted text-muted-foreground",
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", EVENT_STATUS_STYLES[status])}>
      {eventStatusLabel(status)}
    </Badge>
  );
}

const EVENT_DELIVERY_STATUS_STYLES: Record<EventDeliveryStatus, string> = {
  matched: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  triggered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ignored: "bg-muted text-muted-foreground",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function EventDeliveryStatusBadge({ status }: { status: EventDeliveryStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", EVENT_DELIVERY_STATUS_STYLES[status])}>
      {eventDeliveryStatusLabel(status)}
    </Badge>
  );
}

// Agentes v1.6 — Operations Control & Observability (correio.md seção 8).
const CIRCUIT_STATE_STYLES: Record<CircuitState, string> = {
  closed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  open: "bg-red-500/10 text-red-700 dark:text-red-400",
  half_open: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export function CircuitStateBadge({ state }: { state: CircuitState }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", CIRCUIT_STATE_STYLES[state])}>
      {circuitStateLabel(state)}
    </Badge>
  );
}

export function AutonomyBlockReasonBadge({ reason }: { reason: AutonomyBlockReason }) {
  return (
    <Badge variant="secondary" className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400">
      {autonomyBlockReasonLabel(reason)}
    </Badge>
  );
}

export function IncidentTypeBadge({ type }: { type: IncidentType }) {
  return (
    <Badge variant="secondary" className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400">
      {incidentTypeLabel(type)}
    </Badge>
  );
}

// Agentes v1.8 — Director Operations & Business Workflows (correio.md).
const SIGNAL_SEVERITY_STYLES: Record<SignalSeverity, string> = {
  critical: "bg-red-500/10 text-red-700 dark:text-red-400",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  attention: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  info: "bg-muted text-muted-foreground",
};

export function SignalSeverityBadge({ severity }: { severity: SignalSeverity }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", SIGNAL_SEVERITY_STYLES[severity])}>
      {signalSeverityLabel(severity)}
    </Badge>
  );
}

// Agentes v1.9 — Director Decision Queue (correio.md seção 25).
const DECISION_STATUS_STYLES: Record<DecisionStatus, string> = {
  open: "bg-muted text-muted-foreground",
  acknowledged: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  action_planned: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  awaiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  resolved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  dismissed: "bg-muted text-muted-foreground line-through",
};

export function DecisionStatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", DECISION_STATUS_STYLES[status])}>
      {decisionStatusLabel(status)}
    </Badge>
  );
}

// Agentes v2.0 — Director Goals, Initiatives & Executive Planning (correio.md).
const GOAL_HEALTH_STYLES: Record<GoalHealth, string> = {
  on_track: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  attention: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  at_risk: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-700 dark:text-red-400",
  unknown: "bg-muted text-muted-foreground",
};

export function GoalHealthBadge({ health }: { health: GoalHealth }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", GOAL_HEALTH_STYLES[health])}>
      {goalHealthLabel(health)}
    </Badge>
  );
}

const GOAL_STATUS_STYLES: Record<GoalStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  achieved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  missed: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", GOAL_STATUS_STYLES[status])}>
      {goalStatusLabel(status)}
    </Badge>
  );
}

const INITIATIVE_STATUS_STYLES: Record<InitiativeStatus, string> = {
  proposed: "bg-muted text-muted-foreground",
  approved: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  active: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  blocked: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function InitiativeStatusBadge({ status }: { status: InitiativeStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", INITIATIVE_STATUS_STYLES[status])}>
      {initiativeStatusLabel(status)}
    </Badge>
  );
}

// Agentes v2.1 — Initiative Execution & Progress Tracking (correio.md).
const INITIATIVE_EXECUTION_STATE_STYLES: Record<InitiativeExecutionState, string> = {
  not_started: "bg-muted text-muted-foreground",
  waiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  blocked: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

export function InitiativeExecutionStateBadge({ state }: { state: InitiativeExecutionState }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", INITIATIVE_EXECUTION_STATE_STYLES[state])}>
      {initiativeExecutionStateLabel(state)}
    </Badge>
  );
}

// Agentes v2.2 — Executive Review & Strategic Feedback Loop (correio.md
// seção 20) — nunca depender só de cor: cada badge sempre mostra o texto
// completo do outcome/recomendação, cor é reforço visual, não o único sinal.
const REVIEW_OUTCOME_STYLES: Record<ReviewOutcome, string> = {
  successful: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  partially_successful: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  unsuccessful: "bg-red-500/10 text-red-700 dark:text-red-400",
  inconclusive: "bg-muted text-muted-foreground",
  blocked: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export function ReviewOutcomeBadge({ outcome }: { outcome: ReviewOutcome }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", REVIEW_OUTCOME_STYLES[outcome])}>
      {reviewOutcomeLabel(outcome)}
    </Badge>
  );
}

// escalate é sempre o mais destacado (âmbar) — mesmo princípio de
// ACTION_DECISION_STYLES.approval_required: decisão do CEO nunca deve
// passar despercebida.
const RECOMMENDATION_TYPE_STYLES: Record<RecommendationType, string> = {
  none: "bg-muted text-muted-foreground",
  continue: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  adjust: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  new_initiative: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  escalate: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

export function RecommendationTypeBadge({ type }: { type: RecommendationType }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", RECOMMENDATION_TYPE_STYLES[type])}>
      {recommendationTypeLabel(type)}
    </Badge>
  );
}

// Agentes v2.3 — Strategic Learning & Organizational Memory (correio.md).
const MEMORY_STATUS_STYLES: Record<MemoryStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  superseded: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground line-through",
};

export function MemoryStatusBadge({ status }: { status: MemoryStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", MEMORY_STATUS_STYLES[status])}>
      {memoryStatusLabel(status)}
    </Badge>
  );
}

const MEMORY_IMPORTANCE_STYLES: Record<MemoryImportance, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  high: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

export function MemoryImportanceBadge({ importance }: { importance: MemoryImportance }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", MEMORY_IMPORTANCE_STYLES[importance])}>
      {memoryImportanceLabel(importance)}
    </Badge>
  );
}

// Agentes v2.4 — Workflow Recovery, Reconciliation & Operational Resilience.
const RECOVERY_RESULT_STYLES: Record<RecoveryResult, string> = {
  recovered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  retried: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  reverted: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  marked_failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  manual_attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  skipped: "bg-muted text-muted-foreground",
};

export function RecoveryResultBadge({ result }: { result: RecoveryResult }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", RECOVERY_RESULT_STYLES[result])}>
      {recoveryResultLabel(result)}
    </Badge>
  );
}

// Agentes v2.5 — Operational Supervision & Autonomous Incident Response.
const OPERATIONAL_HEALTH_STATUS_STYLES: Record<OperationalHealthStatus, string> = {
  healthy: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  degraded: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  attention_required: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  restricted: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function OperationalHealthStatusBadge({ status }: { status: OperationalHealthStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", OPERATIONAL_HEALTH_STATUS_STYLES[status])}>
      {operationalHealthStatusLabel(status)}
    </Badge>
  );
}

const OPERATIONAL_SEVERITY_STYLES: Record<OperationalSeverity, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function OperationalSeverityBadge({ severity }: { severity: OperationalSeverity }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", OPERATIONAL_SEVERITY_STYLES[severity])}>
      {operationalSeverityLabel(severity)}
    </Badge>
  );
}

export function OperationalIncidentTypeBadge({ type }: { type: OperationalIncidentType }) {
  return (
    <Badge variant="secondary" className="border-transparent bg-muted text-muted-foreground">
      {operationalIncidentTypeLabel(type)}
    </Badge>
  );
}

const OPERATIONAL_RESPONSE_STYLES: Record<OperationalResponse, string> = {
  observe: "bg-muted text-muted-foreground",
  safe_recovery: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  restrict_autonomy: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  manual_attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  already_handled: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

export function OperationalResponseBadge({ response }: { response: OperationalResponse }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", OPERATIONAL_RESPONSE_STYLES[response])}>
      {operationalResponseLabel(response)}
    </Badge>
  );
}

// Agentes v2.6 — Agent Responsibilities, Operational Ownership & Escalation.
const ESCALATION_STATUS_STYLES: Record<EscalationStatus, string> = {
  open: "bg-muted text-muted-foreground",
  acknowledged: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  resolved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  dismissed: "bg-muted text-muted-foreground line-through",
};

export function EscalationStatusBadge({ status }: { status: EscalationStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ESCALATION_STATUS_STYLES[status])}>
      {escalationStatusLabel(status)}
    </Badge>
  );
}

const ESCALATION_SEVERITY_STYLES: Record<EscalationSeverity, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  critical: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function EscalationSeverityBadge({ severity }: { severity: EscalationSeverity }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ESCALATION_SEVERITY_STYLES[severity])}>
      {escalationSeverityLabel(severity)}
    </Badge>
  );
}

// Agentes v2.7 — Operational Follow-up & Coordinated Workflows.
const FOLLOW_UP_STATUS_STYLES: Record<FollowUpStatus, string> = {
  open: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  waiting: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  dismissed: "bg-muted text-muted-foreground line-through",
};

export function FollowUpStatusBadge({ status }: { status: FollowUpStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", FOLLOW_UP_STATUS_STYLES[status])}>
      {followUpStatusLabel(status)}
    </Badge>
  );
}

// Agentes v2.8 — Operational Actions & Governed Resolution.
const ACTION_PROPOSAL_STATUS_STYLES: Record<ActionProposalStatus, string> = {
  submitted: "bg-muted text-muted-foreground",
  planned: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function ActionProposalStatusBadge({ status }: { status: ActionProposalStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ACTION_PROPOSAL_STATUS_STYLES[status])}>
      {actionProposalStatusLabel(status)}
    </Badge>
  );
}
