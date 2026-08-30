"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getAgentTools, listAgentTools } from "@/services/agents";

// Catálogo completo (GET /agents/tools), opcionalmente filtrado por
// departamento (seção 21).
export function useAgentTools(params: { department?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.agents.tools(params),
    queryFn: () => listAgentTools(params),
  });
}

// Tools associadas a um agente específico (GET /agents/:id/tools).
export function useAgentToolsForAgent(agentId: number) {
  return useQuery({
    queryKey: queryKeys.agents.agentTools(agentId),
    queryFn: () => getAgentTools(agentId),
    enabled: Number.isFinite(agentId),
  });
}
