"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  cancelActionProposal,
  createActionProposal,
  getActionProposal,
  listActionProposals,
  submitActionProposal,
  type CreateActionProposalInput,
} from "@/services/agents";

/**
 * Agentes v2.8 — hooks para Operational Action Proposals, mesmo padrão
 * de `use-follow-ups.ts`/`use-escalations.ts`: nenhuma mutação direta,
 * toda ação passa pela rota do backend e invalida lista + detalhe.
 */
export function useActionProposals(followUpId: number | null, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.agents.actionProposals(followUpId ?? -1, params),
    queryFn: () => listActionProposals(followUpId as number, params),
    enabled: followUpId !== null,
  });
}

export function useActionProposal(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.actionProposal(id ?? -1),
    queryFn: () => getActionProposal(id as number),
    enabled: id !== null,
  });
}

function useInvalidateActionProposals(followUpId: number) {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["agents", "follow-ups", followUpId, "action-proposals"] });
    if (id !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.actionProposal(id) });
  };
}

export function useCreateActionProposal(followUpId: number) {
  const invalidate = useInvalidateActionProposals(followUpId);

  return useMutation({
    mutationFn: (input: CreateActionProposalInput) => createActionProposal(followUpId, input),
    onSuccess: () => invalidate(),
  });
}

export function useSubmitActionProposal(followUpId: number) {
  const invalidate = useInvalidateActionProposals(followUpId);

  return useMutation({
    mutationFn: (id: number) => submitActionProposal(id),
    onSuccess: (_, id) => invalidate(id),
  });
}

export function useCancelActionProposal(followUpId: number) {
  const invalidate = useInvalidateActionProposals(followUpId);

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => cancelActionProposal(id, reason),
    onSuccess: (_, { id }) => invalidate(id),
  });
}
