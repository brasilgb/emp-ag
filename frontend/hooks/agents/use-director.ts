"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getDirectorBrief, getDirectorSignal, listDirectorSignals, proposeSignalAction } from "@/services/agents";

// Agentes v1.8 — Director Operations & Business Workflows (correio.md).
export function useDirectorBrief() {
  return useQuery({
    queryKey: queryKeys.agents.directorBrief,
    queryFn: () => getDirectorBrief(),
    refetchInterval: 60000,
  });
}

export function useDirectorSignals() {
  return useQuery({
    queryKey: queryKeys.agents.directorSignals,
    queryFn: () => listDirectorSignals(),
  });
}

export function useDirectorSignal(id: string | null) {
  return useQuery({
    queryKey: queryKeys.agents.directorSignal(id ?? ""),
    queryFn: () => getDirectorSignal(id as string),
    enabled: id !== null,
  });
}

export function useProposeSignalAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => proposeSignalAction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "action-plans"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "approvals"] });
    },
  });
}
