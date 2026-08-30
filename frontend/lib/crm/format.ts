import type { ClientStatus, ClientType, CrmActivityType, LeadSource, LeadStatus } from "@/types/crm";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

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

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Website",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  instagram: "Instagram",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  referral: "Indicação",
  outbound: "Outbound",
  organic: "Orgânico",
  other: "Outro",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  open: "Em aberto",
  won: "Ganho",
  lost: "Perdido",
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  person: "Pessoa física",
  company: "Empresa",
};

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
};

export const ACTIVITY_TYPE_LABELS: Record<CrmActivityType, string> = {
  note: "Nota",
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  whatsapp: "WhatsApp",
  follow_up: "Follow-up",
  status_change: "Mudança de estágio",
  conversion: "Conversão",
  system: "Sistema",
};
