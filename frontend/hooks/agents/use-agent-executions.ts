"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { type ListExecutionsParams, getExecution, listExecutions } from "@/services/agents";

export function useAgentExecutions(params: ListExecutionsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.executions(params),
    queryFn: () => listExecutions(params),
    placeholderData: keepPreviousData,
  });
}

export function useAgentExecution(id: number) {
  return useQuery({
    queryKey: queryKeys.agents.execution(id),
    queryFn: () => getExecution(id),
    enabled: Number.isFinite(id),
  });
}
