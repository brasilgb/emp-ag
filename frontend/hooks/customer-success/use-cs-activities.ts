"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { type ActivityInput, createActivity, listActivities } from "@/services/customer-success";

export function useCSActivities(accountId: number, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.customerSuccess.activities(accountId, params),
    queryFn: () => listActivities(accountId, params),
    enabled: Number.isFinite(accountId),
  });
}

export function useCreateCSActivity(accountId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ActivityInput) => createActivity(accountId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-success", "accounts", accountId] });
    },
  });
}
