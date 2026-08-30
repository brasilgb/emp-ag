"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { type PaymentInput, createPayment, listPayments } from "@/services/financial";

export function usePayments(entryId: number, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.financial.payments(entryId, params),
    queryFn: () => listPayments(entryId, params),
    enabled: Number.isFinite(entryId),
  });
}

export function useCreatePayment(entryId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PaymentInput) => createPayment(entryId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial", "entries", entryId] });
      queryClient.invalidateQueries({ queryKey: ["financial", "entries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.stats });
    },
  });
}
