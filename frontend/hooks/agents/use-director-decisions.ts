"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  acknowledgeDecision,
  assignDecision,
  dismissDecision,
  getDirectorDecision,
  getDirectorDecisionsOverview,
  listDirectorDecisions,
  proposeDecisionAction,
  syncDirectorDecisionQueue,
  type ListDecisionsParams,
} from "@/services/agents";

/**
 * Agentes v1.9 — Director Decision Queue (correio.md seção 25). Espelha o
 * padrão de hooks/agents/use-director.ts (v1.8): nenhuma mutação direta,
 * toda ação passa pela rota do backend correspondente e invalida a fila.
 */
export function useDirectorDecisions(params: ListDecisionsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.directorDecisions(params),
    queryFn: () => listDirectorDecisions(params),
  });
}

export function useDirectorDecisionsOverview() {
  return useQuery({
    queryKey: queryKeys.agents.directorDecisionsOverview,
    queryFn: () => getDirectorDecisionsOverview(),
    refetchInterval: 60000,
  });
}

export function useDirectorDecision(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.directorDecision(id ?? -1),
    queryFn: () => getDirectorDecision(id as number),
    enabled: id !== null,
  });
}

function useInvalidateDecisionQueue() {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["agents", "director", "decisions"] });
    if (id !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorDecision(id) });
  };
}

export function useSyncDecisionQueue() {
  const invalidate = useInvalidateDecisionQueue();

  return useMutation({
    mutationFn: () => syncDirectorDecisionQueue(),
    onSuccess: () => invalidate(),
  });
}

export function useAcknowledgeDecision() {
  const invalidate = useInvalidateDecisionQueue();

  return useMutation({
    mutationFn: (id: number) => acknowledgeDecision(id),
    onSuccess: (_, id) => invalidate(id),
  });
}

export function useAssignDecision() {
  const invalidate = useInvalidateDecisionQueue();

  return useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number }) => assignDecision(id, userId),
    onSuccess: (_, { id }) => invalidate(id),
  });
}

export function useDismissDecision() {
  const invalidate = useInvalidateDecisionQueue();

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => dismissDecision(id, reason),
    onSuccess: (_, { id }) => invalidate(id),
  });
}

export function useProposeDecisionAction() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDecisionQueue();

  return useMutation({
    mutationFn: (id: number) => proposeDecisionAction(id),
    onSuccess: (_, id) => {
      invalidate(id);
      queryClient.invalidateQueries({ queryKey: ["agents", "action-plans"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "approvals"] });
    },
  });
}
