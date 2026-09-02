"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  activateDirectorGoal,
  addGoalMetric,
  approveDirectorInitiative,
  cancelDirectorGoal,
  cancelDirectorInitiative,
  completeDirectorInitiative,
  createDirectorGoal,
  createDirectorInitiative,
  evaluateDirectorGoal,
  getDirectorGoal,
  getDirectorGoalsOverview,
  getDirectorInitiative,
  getGoalMetricCatalog,
  listDirectorGoals,
  listDirectorInitiatives,
  pauseDirectorGoal,
  proposeInitiativeAction,
  updateDirectorGoal,
  type CreateGoalInput,
  type CreateInitiativeInput,
  type ListGoalsParams,
  type ListInitiativesParams,
  type UpdateGoalInput,
} from "@/services/agents";

/**
 * Agentes v2.0 — Director Goals, Initiatives & Executive Planning
 * (correio.md). Mesmo padrão de hooks/agents/use-director-decisions.ts
 * (v1.9): nenhuma mutação direta, toda ação passa pela rota do backend
 * correspondente e invalida as queries afetadas.
 */
export function useDirectorGoals(params: ListGoalsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.directorGoals(params),
    queryFn: () => listDirectorGoals(params),
  });
}

export function useDirectorGoalsOverview() {
  return useQuery({
    queryKey: queryKeys.agents.directorGoalsOverview,
    queryFn: () => getDirectorGoalsOverview(),
    refetchInterval: 60000,
  });
}

export function useDirectorGoal(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.directorGoal(id ?? -1),
    queryFn: () => getDirectorGoal(id as number),
    enabled: id !== null,
  });
}

export function useGoalMetricCatalog() {
  return useQuery({
    queryKey: queryKeys.agents.goalMetricCatalog,
    queryFn: () => getGoalMetricCatalog(),
    staleTime: 5 * 60 * 1000,
  });
}

function useInvalidateGoals(id?: number) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["agents", "director", "goals"] });
    if (id !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(id) });
  };
}

export function useCreateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (input: CreateGoalInput) => createDirectorGoal(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateGoalInput }) => updateDirectorGoal(id, input),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["agents", "director", "goals"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(id) });
    },
  });
}

export function useActivateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => activateDirectorGoal(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["agents", "director", "goals"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(id) });
    },
  });
}

export function usePauseGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => pauseDirectorGoal(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["agents", "director", "goals"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(id) });
    },
  });
}

export function useCancelGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelDirectorGoal(id, reason),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["agents", "director", "goals"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(id) });
    },
  });
}

export function useEvaluateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => evaluateDirectorGoal(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["agents", "director", "goals"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(id) });
    },
  });
}

export function useAddGoalMetric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: number; input: Parameters<typeof addGoalMetric>[1] }) => addGoalMetric(goalId, input),
    onSuccess: (_, { goalId }) => queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(goalId) }),
  });
}

export function useDirectorInitiatives(params: ListInitiativesParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.directorInitiatives(params),
    queryFn: () => listDirectorInitiatives(params),
  });
}

export function useDirectorInitiative(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.directorInitiative(id ?? -1),
    queryFn: () => getDirectorInitiative(id as number),
    enabled: id !== null,
  });
}

function useInvalidateInitiative(goalId?: number) {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["agents", "director", "initiatives"] });
    if (id !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorInitiative(id) });
    if (goalId !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(goalId) });
  };
}

export function useCreateInitiative() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: number; input: CreateInitiativeInput }) => createDirectorInitiative(goalId, input),
    onSuccess: (_, { goalId }) => {
      queryClient.invalidateQueries({ queryKey: ["agents", "director", "initiatives"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.directorGoal(goalId) });
    },
  });
}

export function useApproveInitiative() {
  const invalidate = useInvalidateInitiative();
  return useMutation({
    mutationFn: (id: number) => approveDirectorInitiative(id),
    onSuccess: (_, id) => invalidate(id),
  });
}

export function useCancelInitiative() {
  const invalidate = useInvalidateInitiative();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelDirectorInitiative(id, reason),
    onSuccess: (_, { id }) => invalidate(id),
  });
}

export function useCompleteInitiative() {
  const invalidate = useInvalidateInitiative();
  return useMutation({
    mutationFn: (id: number) => completeDirectorInitiative(id),
    onSuccess: (_, id) => invalidate(id),
  });
}

export function useProposeInitiativeAction() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateInitiative();
  return useMutation({
    mutationFn: (id: number) => proposeInitiativeAction(id),
    onSuccess: (_, id) => {
      invalidate(id);
      queryClient.invalidateQueries({ queryKey: ["agents", "action-plans"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "approvals"] });
    },
  });
}
