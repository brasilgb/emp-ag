"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  createResponsibility,
  deleteResponsibility,
  getResponsibility,
  listResponsibilities,
  updateResponsibility,
  type CreateResponsibilityInput,
  type ListResponsibilitiesParams,
  type UpdateResponsibilityInput,
} from "@/services/agents";

/**
 * Agentes v2.6 (correio.md seção 22) — hooks para o CRUD de Agent
 * Responsibilities, mesmo padrão de hooks/agents/use-director-decisions.ts:
 * nenhuma mutação direta, toda ação passa pela rota do backend e invalida
 * a listagem.
 */
export function useResponsibilities(params: ListResponsibilitiesParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.responsibilities(params),
    queryFn: () => listResponsibilities(params),
  });
}

export function useResponsibility(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.responsibility(id ?? -1),
    queryFn: () => getResponsibility(id as number),
    enabled: id !== null,
  });
}

function useInvalidateResponsibilities() {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["agents", "responsibilities"] });
    if (id !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.responsibility(id) });
  };
}

export function useCreateResponsibility() {
  const invalidate = useInvalidateResponsibilities();

  return useMutation({
    mutationFn: (input: CreateResponsibilityInput) => createResponsibility(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateResponsibility() {
  const invalidate = useInvalidateResponsibilities();

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateResponsibilityInput }) => updateResponsibility(id, input),
    onSuccess: (_, { id }) => invalidate(id),
  });
}

export function useDeleteResponsibility() {
  const invalidate = useInvalidateResponsibilities();

  return useMutation({
    mutationFn: (id: number) => deleteResponsibility(id),
    onSuccess: (_, id) => invalidate(id),
  });
}
