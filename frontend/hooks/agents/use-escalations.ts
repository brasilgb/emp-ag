"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  acknowledgeEscalation,
  dismissEscalation,
  getEscalation,
  listEscalations,
  resolveEscalation,
  type ListEscalationsParams,
} from "@/services/agents";

/**
 * Agentes v2.6 (correio.md seção 22) — hooks para leitura e transições
 * (acknowledge/resolve/dismiss) de Operational Escalations. Nenhum hook
 * de criação — não existe endpoint de criação livre (seção 19).
 */
export function useEscalations(params: ListEscalationsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.escalations(params),
    queryFn: () => listEscalations(params),
  });
}

export function useEscalation(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.escalation(id ?? -1),
    queryFn: () => getEscalation(id as number),
    enabled: id !== null,
  });
}

function useInvalidateEscalations() {
  const queryClient = useQueryClient();
  return (id?: number) => {
    queryClient.invalidateQueries({ queryKey: ["agents", "escalations"] });
    if (id !== undefined) queryClient.invalidateQueries({ queryKey: queryKeys.agents.escalation(id) });
  };
}

export function useAcknowledgeEscalation() {
  const invalidate = useInvalidateEscalations();

  return useMutation({
    mutationFn: (id: number) => acknowledgeEscalation(id),
    onSuccess: (_, id) => invalidate(id),
  });
}

export function useResolveEscalation() {
  const invalidate = useInvalidateEscalations();

  return useMutation({
    mutationFn: (id: number) => resolveEscalation(id),
    onSuccess: (_, id) => invalidate(id),
  });
}

export function useDismissEscalation() {
  const invalidate = useInvalidateEscalations();

  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => dismissEscalation(id, reason),
    onSuccess: (_, { id }) => invalidate(id),
  });
}
