"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type EntryInput,
  type ListEntriesParams,
  createEntry,
  getEntry,
  getEntryHistory,
  listEntries,
  updateEntry,
} from "@/services/financial";

export function useEntries(params: ListEntriesParams = {}) {
  return useQuery({
    queryKey: queryKeys.financial.entries(params),
    queryFn: () => listEntries(params),
    placeholderData: keepPreviousData,
  });
}

export function useEntry(id: number) {
  return useQuery({
    queryKey: queryKeys.financial.entry(id),
    queryFn: () => getEntry(id),
    enabled: Number.isFinite(id),
  });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: EntryInput) => createEntry(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial", "entries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.stats });
    },
  });
}

export function useUpdateEntry(id: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<EntryInput>) => updateEntry(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial", "entries"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.financial.stats });
    },
  });
}

export function useEntryHistory(id: number) {
  return useQuery({
    queryKey: queryKeys.financial.history(id),
    queryFn: () => getEntryHistory(id),
    enabled: Number.isFinite(id),
  });
}
