"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type OpportunityInput,
  type OpportunityUpdateInput,
  createOpportunity,
  listOpportunities,
  updateOpportunity,
} from "@/services/customer-success";
import type { OpportunityStatus, OpportunityType } from "@/types/customer-success";

export function useCSOpportunities(
  params: { status?: OpportunityStatus; type?: OpportunityType; client?: number; owner?: number } = {},
) {
  return useQuery({
    queryKey: queryKeys.customerSuccess.opportunities(params),
    queryFn: () => listOpportunities(params),
  });
}

export function useCreateOpportunity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: OpportunityInput) => createOpportunity(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-success", "opportunities"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.customerSuccess.stats });
    },
  });
}

export function useUpdateOpportunity(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: OpportunityUpdateInput) => updateOpportunity(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-success", "opportunities"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.customerSuccess.stats });
    },
  });
}
