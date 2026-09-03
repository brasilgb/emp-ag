"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  generateMemoryFromReview,
  getStrategicMemory,
  listStrategicMemories,
  type ListStrategicMemoriesParams,
} from "@/services/agents";

/**
 * Agentes v2.3 — Strategic Learning & Organizational Memory (correio.md).
 * Mesmo padrão de hooks/agents/use-director-goals.ts: nenhuma mutação
 * direta, toda ação passa pela rota do backend correspondente e invalida
 * as queries afetadas.
 */
export function useStrategicMemories(params: ListStrategicMemoriesParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.directorMemories(params),
    queryFn: () => listStrategicMemories(params),
  });
}

export function useStrategicMemory(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.directorMemory(id ?? -1),
    queryFn: () => getStrategicMemory(id as number),
    enabled: id !== null,
  });
}

export function useGenerateMemoryFromReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: number) => generateMemoryFromReview(reviewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "director", "memories"] });
    },
  });
}
