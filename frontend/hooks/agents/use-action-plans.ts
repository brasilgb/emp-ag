"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { type ListActionPlansParams, createActionPlan, getActionPlan, listActionPlans } from "@/services/agents";

// Agentes v1.2 — Action Planning (correio.md seções 8/9). Mesmo padrão de
// hooks/agents/use-agent-approvals.ts e use-agent-executions.ts.
export function useActionPlans(params: ListActionPlansParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.actionPlans(params),
    queryFn: () => listActionPlans(params),
    placeholderData: keepPreviousData,
  });
}

export function useActionPlan(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.actionPlan(id ?? 0),
    queryFn: () => getActionPlan(id as number),
    enabled: id !== null,
  });
}

export function useCreateActionPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (objective: string) => createActionPlan(objective),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "action-plans"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "approvals"] });
    },
  });
}
