import type {
  ChurnRisk,
  CsAccountStatus,
  CsActivityType,
  OnboardingStatus,
  OpportunityStatus,
  OpportunityType,
} from "@/types/customer-success";

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "--";
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return currencyFormatter.format(num);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return dateFormatter.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return dateTimeFormatter.format(date);
}

export const CS_ACCOUNT_STATUS_LABELS: Record<CsAccountStatus, string> = {
  onboarding: "Onboarding",
  active: "Ativo",
  attention: "Atenção",
  at_risk: "Em risco",
  inactive: "Inativo",
};

export const ONBOARDING_STATUS_LABELS: Record<OnboardingStatus, string> = {
  not_started: "Não iniciado",
  in_progress: "Em andamento",
  completed: "Concluído",
  blocked: "Bloqueado",
};

export const CHURN_RISK_LABELS: Record<ChurnRisk, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
};

export const ACTIVITY_TYPE_LABELS: Record<CsActivityType, string> = {
  onboarding: "Onboarding",
  follow_up: "Follow-up",
  meeting: "Reunião",
  training: "Treinamento",
  satisfaction: "Satisfação",
  renewal: "Renovação",
  upsell: "Upsell",
  cross_sell: "Cross-sell",
  risk: "Risco",
  note: "Nota",
};

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  upsell: "Upsell",
  cross_sell: "Cross-sell",
  renewal: "Renovação",
};

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  identified: "Identificada",
  qualified: "Qualificada",
  proposed: "Proposta enviada",
  won: "Ganha",
  lost: "Perdida",
};
