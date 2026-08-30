import type { Paginated } from "@/types/shared";
import type {
  MessageType,
  Priority,
  Source,
  SupportCategory,
  SupportMessage,
  SupportStats,
  SupportTicket,
  SupportTicketHistoryEntry,
  TicketStatus,
} from "@/types/support";

import { apiFetch, toQueryString } from "./http";

export interface ListTicketsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: TicketStatus;
  priority?: Priority;
  category?: number;
  client?: number;
  project?: number;
  owner?: number;
  source?: Source;
  overdue?: boolean;
}

export interface TicketInput {
  clientId: number;
  projectId?: number;
  categoryId: number;
  title: string;
  description?: string;
  priority?: Priority;
  source: Source;
}

export interface TicketUpdateInput {
  clientId?: number;
  projectId?: number;
  categoryId?: number;
  title?: string;
  description?: string;
  priority?: Priority;
  source?: Source;
  ownerUserId?: number;
  status?: TicketStatus;
  resolution?: string;
}

export interface MessageInput {
  type?: MessageType;
  content: string;
  isInternal?: boolean;
}

export interface CategoryInput {
  name: string;
  slug: string;
  description?: string;
  defaultPriority?: Priority;
  isActive?: boolean;
}

export function listTickets(params: ListTicketsParams = {}): Promise<Paginated<SupportTicket>> {
  return apiFetch(`/api/support/tickets${toQueryString({ ...params })}`);
}

export function getTicket(id: number): Promise<{ data: SupportTicket }> {
  return apiFetch(`/api/support/tickets/${id}`);
}

export function createTicket(input: TicketInput): Promise<{ data: SupportTicket }> {
  return apiFetch("/api/support/tickets", { method: "POST", body: JSON.stringify(input) });
}

export function updateTicket(id: number, input: TicketUpdateInput): Promise<{ data: SupportTicket }> {
  return apiFetch(`/api/support/tickets/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function listMessages(
  ticketId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<SupportMessage>> {
  return apiFetch(`/api/support/tickets/${ticketId}/messages${toQueryString({ ...params })}`);
}

export function createMessage(ticketId: number, input: MessageInput): Promise<{ data: SupportMessage }> {
  return apiFetch(`/api/support/tickets/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getTicketHistory(
  ticketId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<SupportTicketHistoryEntry>> {
  return apiFetch(`/api/support/tickets/${ticketId}/history${toQueryString({ ...params })}`);
}

export function listCategories(
  params: { search?: string; isActive?: boolean } = {},
): Promise<{ data: SupportCategory[] }> {
  return apiFetch(`/api/support/categories${toQueryString({ ...params })}`);
}

export function createCategory(input: CategoryInput): Promise<{ data: SupportCategory }> {
  return apiFetch("/api/support/categories", { method: "POST", body: JSON.stringify(input) });
}

export function getStats(): Promise<SupportStats> {
  return apiFetch("/api/support/stats");
}
