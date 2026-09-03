"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  completeFollowUp,
  createManualFollowUp,
  dismissFollowUp,
  getFollowUp,
  listFollowUps,
  reassignFollowUp,
  resumeFollowUp,
  startFollowUp,
  waitFollowUp,
  type CreateManualFollowUpInput,
  type ListFollowUpsParams,
} from "@/services/agents";

/**
 * Agentes v2.7 (correio.md seção 22, arquitetura análoga) — hooks para
 * Operational FollowUps, mesmo padrão de `use-escalations.ts`/
 * `use-responsibilities.ts`: nenhuma mutação direta, toda ação passa
 * pela rota do backend correspondente e invalida lista + detalhe.
 */
export function useFollowUps(params: ListFollowUpsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.followUps(params),
    queryFn: () => listFollowUps(params),
  });
}

export function useFollowUp(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.followUp(id ?? -1),
    queryFn: () => getFollowUp(id as number),
    enabled: id !== null,
  });
}

function useInvalidateFollowUps() {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["agents", "follow-ups"] });
    if (id !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.followUp(id) });
  };
}

export function useCreateManualFollowUp() {
  const invalidate = useInvalidateFollowUps();

  return useMutation({
    mutationFn: (input: CreateManualFollowUpInput) => createManualFollowUp(input),
    onSuccess: () => invalidate(),
  });
}

export function useStartFollowUp() {
  const invalidate = useInvalidateFollowUps();
  return useMutation({ mutationFn: (id: number) => startFollowUp(id), onSuccess: (_, id) => invalidate(id) });
}

export function useWaitFollowUp() {
  const invalidate = useInvalidateFollowUps();
  return useMutation({
    mutationFn: ({ id, waitingReason, waitingUntil }: { id: number; waitingReason: string; waitingUntil?: string }) =>
      waitFollowUp(id, waitingReason, waitingUntil),
    onSuccess: (_, { id }) => invalidate(id),
  });
}

export function useResumeFollowUp() {
  const invalidate = useInvalidateFollowUps();
  return useMutation({ mutationFn: (id: number) => resumeFollowUp(id), onSuccess: (_, id) => invalidate(id) });
}

export function useCompleteFollowUp() {
  const invalidate = useInvalidateFollowUps();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: number; resolution: string }) => completeFollowUp(id, resolution),
    onSuccess: (_, { id }) => invalidate(id),
  });
}

export function useDismissFollowUp() {
  const invalidate = useInvalidateFollowUps();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => dismissFollowUp(id, reason),
    onSuccess: (_, { id }) => invalidate(id),
  });
}

export function useReassignFollowUp() {
  const invalidate = useInvalidateFollowUps();
  return useMutation({
    mutationFn: ({ id, assignedUserId }: { id: number; assignedUserId: number | null }) => reassignFollowUp(id, assignedUserId),
    onSuccess: (_, { id }) => invalidate(id),
  });
}
