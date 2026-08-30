"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ActivityInput,
  createClientActivity,
  createLeadActivity,
  listClientActivities,
  listLeadActivities,
} from "@/services/crm";

export function useLeadActivities(leadId: number) {
  return useQuery({
    queryKey: queryKeys.crm.leadActivities(leadId),
    queryFn: () => listLeadActivities(leadId),
    enabled: Number.isFinite(leadId),
  });
}

export function useCreateLeadActivity(leadId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ActivityInput) => createLeadActivity(leadId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "leads", leadId, "activities"] });
    },
  });
}

export function useClientActivities(clientId: number) {
  return useQuery({
    queryKey: queryKeys.crm.clientActivities(clientId),
    queryFn: () => listClientActivities(clientId),
    enabled: Number.isFinite(clientId),
  });
}

export function useCreateClientActivity(clientId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ActivityInput) => createClientActivity(clientId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm", "clients", clientId, "activities"] });
    },
  });
}
