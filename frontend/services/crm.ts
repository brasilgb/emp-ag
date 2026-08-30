import type { CrmActivity, CrmActivityType, Paginated, PipelineStageWithLeads } from "@/types/crm";

import { apiFetch, toQueryString } from "./http";

export interface ActivityInput {
  type: CrmActivityType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export function getPipeline(): Promise<{ stages: PipelineStageWithLeads[] }> {
  return apiFetch("/api/crm/pipeline");
}

export function listLeadActivities(
  leadId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<CrmActivity>> {
  return apiFetch(`/api/crm/leads/${leadId}/activities${toQueryString(params)}`);
}

export function createLeadActivity(leadId: number, input: ActivityInput): Promise<{ data: CrmActivity }> {
  return apiFetch(`/api/crm/leads/${leadId}/activities`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listClientActivities(
  clientId: number,
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<CrmActivity>> {
  return apiFetch(`/api/crm/clients/${clientId}/activities${toQueryString(params)}`);
}

export function createClientActivity(clientId: number, input: ActivityInput): Promise<{ data: CrmActivity }> {
  return apiFetch(`/api/crm/clients/${clientId}/activities`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
