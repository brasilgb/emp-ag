"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getAgent, listAgents } from "@/services/agents";

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents.list,
    queryFn: () => listAgents(),
  });
}

export function useAgent(id: number) {
  return useQuery({
    queryKey: queryKeys.agents.detail(id),
    queryFn: () => getAgent(id),
    enabled: Number.isFinite(id),
  });
}
