import type { ConvertLeadResult, Lead, LeadListItem, LeadSource, Paginated } from "@/types/crm";

import { apiFetch, toQueryString } from "./http";

export interface ListLeadsParams {
  page?: number;
  limit?: number;
  search?: string;
  stage?: string; // slug ou id do estágio
  owner?: number;
  source?: LeadSource;
}

export interface LeadInput {
  name: string;
  companyName?: string;
  email?: string;
  phone?: string;
  source?: LeadSource;
  pipelineStageId?: number;
  ownerUserId?: number;
  estimatedValue?: number | string;
  probability?: number;
  nextActionAt?: string;
  nextActionDescription?: string;
  notes?: string;
}

export function listLeads(params: ListLeadsParams = {}): Promise<Paginated<LeadListItem>> {
  return apiFetch(`/api/crm/leads${toQueryString({ ...params })}`);
}

export function getLead(id: number): Promise<{ data: LeadListItem }> {
  return apiFetch(`/api/crm/leads/${id}`);
}

export function createLead(input: LeadInput): Promise<{ data: Lead }> {
  return apiFetch("/api/crm/leads", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateLead(id: number, input: Partial<LeadInput>): Promise<{ data: Lead }> {
  return apiFetch(`/api/crm/leads/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function convertLead(id: number): Promise<{ data: ConvertLeadResult }> {
  return apiFetch(`/api/crm/leads/${id}/convert`, {
    method: "POST",
  });
}
