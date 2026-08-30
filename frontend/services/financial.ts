import type { Paginated } from "@/types/shared";
import type {
  FinancialCategory,
  FinancialCategoryType,
  FinancialEntry,
  FinancialEntryStatusFilter,
  FinancialEntryType,
  FinancialHistoryEntry,
  FinancialPayment,
  FinancialStats,
  PaymentMethod,
} from "@/types/financial";

import { apiFetch, toQueryString } from "./http";

export interface ListEntriesParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: FinancialEntryType;
  status?: FinancialEntryStatusFilter;
  category?: number;
  client?: number;
  project?: number;
  due_from?: string;
  due_to?: string;
  competence_from?: string;
  competence_to?: string;
}

export interface EntryInput {
  type: FinancialEntryType;
  categoryId: number;
  clientId?: number;
  projectId?: number;
  description: string;
  amount: number;
  issueDate: string;
  dueDate: string;
  competenceDate: string;
  paymentMethod?: PaymentMethod;
  reference?: string;
  notes?: string;
}

export interface PaymentInput {
  amount: number;
  paidAt?: string;
  paymentMethod?: PaymentMethod;
  reference?: string;
  notes?: string;
}

export interface CategoryInput {
  name: string;
  slug: string;
  type: FinancialCategoryType;
  isActive?: boolean;
}

export function listEntries(params: ListEntriesParams = {}): Promise<Paginated<FinancialEntry>> {
  return apiFetch(`/api/financial/entries${toQueryString({ ...params })}`);
}

export function getEntry(id: number): Promise<{ data: FinancialEntry }> {
  return apiFetch(`/api/financial/entries/${id}`);
}

export function createEntry(input: EntryInput): Promise<{ data: FinancialEntry }> {
  return apiFetch("/api/financial/entries", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateEntry(
  id: number,
  input: Partial<EntryInput>,
): Promise<{ data: FinancialEntry }> {
  return apiFetch(`/api/financial/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getEntryHistory(id: number): Promise<{ data: FinancialHistoryEntry[] }> {
  return apiFetch(`/api/financial/entries/${id}/history`);
}

export function listPayments(
  entryId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<FinancialPayment>> {
  return apiFetch(`/api/financial/entries/${entryId}/payments${toQueryString({ ...params })}`);
}

export function createPayment(
  entryId: number,
  input: PaymentInput,
): Promise<{ data: { payment: FinancialPayment; entry: FinancialEntry } }> {
  return apiFetch(`/api/financial/entries/${entryId}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listCategories(
  params: { search?: string; type?: FinancialCategoryType; isActive?: boolean } = {},
): Promise<{ data: FinancialCategory[] }> {
  return apiFetch(`/api/financial/categories${toQueryString({ ...params })}`);
}

export function createCategory(input: CategoryInput): Promise<{ data: FinancialCategory }> {
  return apiFetch("/api/financial/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCategory(
  id: number,
  input: Partial<CategoryInput>,
): Promise<{ data: FinancialCategory }> {
  return apiFetch(`/api/financial/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getStats(): Promise<FinancialStats> {
  return apiFetch("/api/financial/stats");
}

// GET /financial/cash-flow, /financial/forecast e
// /financial/projects/:id/summary não têm wrapper aqui nem tela nesta v1
// (ver decisão 4 do plano) — já expostos pelo backend para consumo futuro
// (dashboard de caixa, agente financeiro, página de projeto).
