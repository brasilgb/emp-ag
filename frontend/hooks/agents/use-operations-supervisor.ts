"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  getOperationalHealth,
  getOperationalIncidents,
  getOperationalSupervisionSchedulerStatus,
  runOperationalSupervision,
  setOperationalSupervisionSchedulerEnabled,
} from "@/services/agents";

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

// Agentes v2.5.1 — Automatic Operational Supervision (correio.md).
export function useOperationalSupervisionSchedulerStatus() {
  return useQuery({
    queryKey: queryKeys.agents.operationalSupervisionScheduler,
    queryFn: () => getOperationalSupervisionSchedulerStatus(),
    // Tela operacional — refetch periódico enquanto aberta, mesmo padrão
    // de useDirectorGoalsOverview (60s), útil para acompanhar
    // lastCompletedAt/running sem precisar recarregar a página.
    refetchInterval: 30000,
  });
}

export function useSetOperationalSupervisionSchedulerEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => setOperationalSupervisionSchedulerEnabled(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agents.operationalSupervisionScheduler }),
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
