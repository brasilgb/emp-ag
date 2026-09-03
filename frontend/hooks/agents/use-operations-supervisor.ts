"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getOperationalHealth, getOperationalIncidents, runOperationalSupervision } from "@/services/agents";

/**
 * Agentes v2.5 — Operational Supervision & Autonomous Incident Response
 * (correio.md). Mesmo padrão dos demais hooks do módulo: nenhuma
 * mutação direta, toda ação passa pela rota do backend correspondente e
 * invalida as queries afetadas.
 */
export function useOperationalHealth() {
  return useQuery({
    queryKey: queryKeys.agents.operationalHealth,
    queryFn: () => getOperationalHealth(),
  });
}

export function useOperationalIncidents() {
  return useQuery({
    queryKey: queryKeys.agents.operationalIncidents,
    queryFn: () => getOperationalIncidents(),
  });
}

export function useRunOperationalSupervision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dryRun: boolean) => runOperationalSupervision(dryRun),
    onSuccess: (_, dryRun) => {
      if (!dryRun) {
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.operationalHealth });
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.operationalIncidents });
        // A supervisão real pode ter chamado Recovery v2.4 (safe_recovery)
        // ou restringido autonomia de Job — invalida os domínios afetados
        // também, nunca deixa a UI desses módulos desatualizada.
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.recoveryStatus });
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.recoveryStale });
        queryClient.invalidateQueries({ queryKey: ["agents", "jobs"] });
        queryClient.invalidateQueries({ queryKey: ["agents", "director", "decisions"] });
      }
    },
  });
}
