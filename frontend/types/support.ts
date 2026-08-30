export type { Paginated, PaginationMeta } from "./shared";

export const TICKET_STATUSES = [
  "open",
  "triage",
  "in_progress",
  "waiting_customer",
  "waiting_internal",
  "resolved",
  "closed",
  "cancelled",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SOURCES = [
  "manual",
  "email",
  "whatsapp",
  "phone",
  "website",
  "internal",
  "other",
] as const;
export type Source = (typeof SOURCES)[number];

export const MESSAGE_TYPES = ["message", "note", "system"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface SupportCategory {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  defaultPriority: Priority;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicket {
  id: number;
  clientId: number;
  clientName: string;
  projectId: number | null;
  projectName: string | null;
  categoryId: number;
  categoryName: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: Priority;
  source: Source;
  ownerUserId: number | null;
  ownerName: string | null;
  openedByUserId: number | null;
  openedByName: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolution: string | null;
  slaDueAt: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: number;
  ticketId: number;
  userId: number | null;
  type: MessageType;
  content: string;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketHistoryEntry {
  id: number;
  ticketId: number;
  actorType: string;
  actorId: string | null;
  event: string;
  oldData: unknown;
  newData: unknown;
  metadata: unknown;
  createdAt: string;
}

export interface SupportStats {
  open: number;
  inProgress: number;
  waitingCustomer: number;
  critical: number;
  overdue: number;
  resolvedThisMonth: number;
  averageFirstResponseMinutes: number;
  averageResolutionMinutes: number;
}
