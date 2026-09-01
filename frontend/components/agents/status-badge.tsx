import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  actionDecisionLabel,
  actionPlanItemStatusLabel,
  actionPlanStatusLabel,
  actionRiskLabel,
  approvalStateLabel,
  autonomyLevelBadgeVariant,
  autonomyLevelLabel,
  eventDeliveryStatusLabel,
  eventStatusLabel,
  executionStatusLabel,
  humanVerdictLabel,
  interpretationCategoryLabel,
  interpretationErrorTypeLabel,
  jobRunStatusLabel,
  jobStatusLabel,
  type DerivedApprovalState,
} from "@/lib/agents/derived";
import type {
  ActionDecision,
  ActionPlanItemStatus,
  ActionPlanStatus,
  ActionRisk,
  AutonomyLevel,
  EventDeliveryStatus,
  EventStatus,
  ExecutionStatus,
  HumanVerdict,
  InterpretationCategory,
  InterpretationError,
  JobRunStatus,
  JobStatus,
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
