export type { Paginated, PaginationMeta } from "./shared";

export const CS_ACCOUNT_STATUSES = ["onboarding", "active", "attention", "at_risk", "inactive"] as const;
export type CsAccountStatus = (typeof CS_ACCOUNT_STATUSES)[number];

export const ONBOARDING_STATUSES = ["not_started", "in_progress", "completed", "blocked"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const CHURN_RISKS = ["low", "medium", "high"] as const;
export type ChurnRisk = (typeof CHURN_RISKS)[number];

export const ACTIVITY_TYPES = [
  "onboarding",
  "follow_up",
  "meeting",
  "training",
  "satisfaction",
  "renewal",
  "upsell",
  "cross_sell",
  "risk",
  "note",
] as const;
export type CsActivityType = (typeof ACTIVITY_TYPES)[number];

export const OPPORTUNITY_TYPES = ["upsell", "cross_sell", "renewal"] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_STATUSES = ["identified", "qualified", "proposed", "won", "lost"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export interface CsAccount {
  id: number;
  clientId: number;
  clientName: string;
  ownerUserId: number | null;
  ownerName: string | null;
  status: CsAccountStatus;
  healthScore: number;
  onboardingStatus: OnboardingStatus;
  lastContactAt: string | null;
  nextContactAt: string | null;
  satisfactionScore: number | null;
  churnRisk: ChurnRisk;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CsActivity {
  id: number;
  csAccountId: number;
  userId: number | null;
  type: CsActivityType;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
}

export interface CsOpportunity {
  id: number;
  clientId: number;
  clientName: string;
  csAccountId: number | null;
  type: OpportunityType;
  title: string;
  description: string | null;
  // Vem do backend como string (coluna numeric) para preservar precisão.
  estimatedValue: string | null;
  status: OpportunityStatus;
  ownerUserId: number | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CsStats {
  activeAccounts: number;
  onboarding: number;
  attention: number;
  atRisk: number;
  followUpsDue: number;
  averageHealthScore: number;
  averageSatisfaction: number;
  expansionPipelineValue: string;
}
