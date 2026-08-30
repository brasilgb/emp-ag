import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CHURN_RISK_LABELS, CS_ACCOUNT_STATUS_LABELS, ONBOARDING_STATUS_LABELS } from "@/lib/customer-success/format";
import type { ChurnRisk, CsAccountStatus, OnboardingStatus } from "@/types/customer-success";

const ACCOUNT_STATUS_STYLES: Record<CsAccountStatus, string> = {
  onboarding: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  at_risk: "bg-red-500/10 text-red-700 dark:text-red-400",
  inactive: "bg-muted text-muted-foreground",
};

const CHURN_RISK_STYLES: Record<ChurnRisk, string> = {
  low: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  high: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const ONBOARDING_STYLES: Record<OnboardingStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  blocked: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function CsAccountStatusBadge({ status }: { status: CsAccountStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ACCOUNT_STATUS_STYLES[status])}>
      {CS_ACCOUNT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ChurnRiskBadge({ risk }: { risk: ChurnRisk }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", CHURN_RISK_STYLES[risk])}>
      {CHURN_RISK_LABELS[risk]}
    </Badge>
  );
}

export function OnboardingStatusBadge({ status }: { status: OnboardingStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", ONBOARDING_STYLES[status])}>
      {ONBOARDING_STATUS_LABELS[status]}
    </Badge>
  );
}
