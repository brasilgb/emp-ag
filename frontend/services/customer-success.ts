import type { Paginated } from "@/types/shared";
import type {
  ChurnRisk,
  CsAccount,
  CsAccountStatus,
  CsActivity,
  CsActivityType,
  CsOpportunity,
  CsStats,
  OnboardingStatus,
  OpportunityStatus,
  OpportunityType,
} from "@/types/customer-success";

import { apiFetch, toQueryString } from "./http";

export interface ListAccountsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: CsAccountStatus;
  churnRisk?: ChurnRisk;
  owner?: number;
}

export interface AccountUpdateInput {
  ownerUserId?: number;
  status?: CsAccountStatus;
  healthScore?: number;
  onboardingStatus?: OnboardingStatus;
  lastContactAt?: string;
  nextContactAt?: string;
  satisfactionScore?: number | null;
  churnRisk?: ChurnRisk;
  notes?: string;
}

export interface ActivityInput {
  type: CsActivityType;
  title: string;
  description?: string;
  occurredAt?: string;
}

export interface OpportunityInput {
  clientId: number;
  type: OpportunityType;
  title: string;
  description?: string;
  estimatedValue?: number;
  ownerUserId?: number;
}

export interface OpportunityUpdateInput {
  type?: OpportunityType;
  title?: string;
  description?: string;
  estimatedValue?: number;
  status?: OpportunityStatus;
  ownerUserId?: number;
}

export function listAccounts(params: ListAccountsParams = {}): Promise<Paginated<CsAccount>> {
  return apiFetch(`/api/customer-success/accounts${toQueryString({ ...params })}`);
}

export function getAccount(id: number): Promise<{ data: CsAccount }> {
  return apiFetch(`/api/customer-success/accounts/${id}`);
}

export function ensureAccount(clientId: number): Promise<{ data: CsAccount }> {
  return apiFetch("/api/customer-success/accounts", {
    method: "POST",
    body: JSON.stringify({ clientId }),
  });
}

export function updateAccount(id: number, input: AccountUpdateInput): Promise<{ data: CsAccount }> {
  return apiFetch(`/api/customer-success/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function listActivities(
  accountId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<CsActivity>> {
  return apiFetch(`/api/customer-success/accounts/${accountId}/activities${toQueryString({ ...params })}`);
}

export function createActivity(accountId: number, input: ActivityInput): Promise<{ data: CsActivity }> {
  return apiFetch(`/api/customer-success/accounts/${accountId}/activities`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listOpportunities(
  params: { status?: OpportunityStatus; type?: OpportunityType; client?: number; owner?: number } = {},
): Promise<Paginated<CsOpportunity>> {
  return apiFetch(`/api/customer-success/opportunities${toQueryString({ ...params })}`);
}

export function createOpportunity(input: OpportunityInput): Promise<{ data: CsOpportunity }> {
  return apiFetch("/api/customer-success/opportunities", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateOpportunity(
  id: number,
  input: OpportunityUpdateInput,
): Promise<{ data: CsOpportunity }> {
  return apiFetch(`/api/customer-success/opportunities/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getStats(): Promise<CsStats> {
  return apiFetch("/api/customer-success/stats");
}
