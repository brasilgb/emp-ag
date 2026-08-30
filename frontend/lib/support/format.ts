import type { MessageType, Priority, Source, TicketStatus } from "@/types/support";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

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

export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Aberto",
  triage: "Triagem",
  in_progress: "Em atendimento",
  waiting_customer: "Aguardando cliente",
  waiting_internal: "Aguardando interno",
  resolved: "Resolvido",
  closed: "Fechado",
  cancelled: "Cancelado",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

export const SOURCE_LABELS: Record<Source, string> = {
  manual: "Manual",
  email: "E-mail",
  whatsapp: "WhatsApp",
  phone: "Telefone",
  website: "Website",
  internal: "Interno",
  other: "Outro",
};

export const MESSAGE_TYPE_LABELS: Record<MessageType, string> = {
  message: "Mensagem",
  note: "Nota interna",
  system: "Sistema",
};
