"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type LeadInput,
  type ListLeadsParams,
  convertLead,
  createLead,
  getLead,
  listLeads,
  updateLead,
} from "@/services/leads";

function invalidateLeadRelatedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["crm", "leads"] });
  queryClient.invalidateQueries({ queryKey: queryKeys.crm.pipeline });
}

export function useLeads(params: ListLeadsParams = {}) {
  return useQuery({
    queryKey: queryKeys.crm.leads(params),
    queryFn: () => listLeads(params),
    placeholderData: keepPreviousData,
  });
}

export function useLead(id: number) {
  return useQuery({
    queryKey: queryKeys.crm.lead(id),
    queryFn: () => getLead(id),
    enabled: Number.isFinite(id),
  });
}

export function useCreateLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: LeadInput) => createLead(input),
    onSuccess: () => invalidateLeadRelatedQueries(queryClient),
  });
}

export function useUpdateLead(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<LeadInput>) => updateLead(id, input),
    onSuccess: () => invalidateLeadRelatedQueries(queryClient),
  });
}

export function useConvertLead(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => convertLead(id),
    onSuccess: () => {
      invalidateLeadRelatedQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["crm", "clients"] });
    },
  });
}
