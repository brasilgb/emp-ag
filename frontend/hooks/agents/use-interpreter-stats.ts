"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getInterpreterStats, reviewInterpretation } from "@/services/agents";
import type { HumanVerdict } from "@/types/agents";

// v1.1 — seção 28: tela de observabilidade do LLM Interpreter.
export function useInterpreterStats() {
  return useQuery({
    queryKey: queryKeys.agents.interpreterStats,
    queryFn: () => getInterpreterStats(),
    // Números mudam com cada chat — mantém razoavelmente fresco sem
    // sobrecarregar o backend.
    refetchInterval: 30_000,
  });
}

// Seção 30 — feedback humano (correto/incorreto) sobre uma interpretação.
export function useReviewInterpretation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, verdict }: { id: number; verdict: HumanVerdict }) => reviewInterpretation(id, verdict),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.interpreterStats });
    },
  });
}
