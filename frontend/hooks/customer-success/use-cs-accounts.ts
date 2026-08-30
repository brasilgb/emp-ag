"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type AccountUpdateInput,
  type ListAccountsParams,
  ensureAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "@/services/customer-success";

export function useCSAccounts(params: ListAccountsParams = {}) {
  return useQuery({
    queryKey: queryKeys.customerSuccess.accounts(params),
    queryFn: () => listAccounts(params),
    placeholderData: keepPreviousData,
  });
}

export function useCSAccount(id: number) {
  return useQuery({
    queryKey: queryKeys.customerSuccess.account(id),
    queryFn: () => getAccount(id),
    enabled: Number.isFinite(id),
  });
}

export function useCreateCSAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clientId: number) => ensureAccount(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-success", "accounts"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.customerSuccess.stats });
    },
  });
}

export function useUpdateCSAccount(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AccountUpdateInput) => updateAccount(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-success", "accounts"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.customerSuccess.stats });
    },
  });
}
