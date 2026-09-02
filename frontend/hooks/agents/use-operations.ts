"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ListAuditLogsParams,
  type ListIncidentsParams,
  type OperationsSummaryParams,
  getGlobalAutonomy,
  getJobRunDetail,
  getJobRunLineage,
  getOperationsSummary,
  listAuditLogs,
  listIncidents,
  setGlobalAutonomy,
} from "@/services/agents";

// Agentes v1.6 — Operations Control & Observability (correio.md). Mesmo
// padrão de hooks/agents/use-agent-jobs.ts.
export function useOperationsSummary(params: OperationsSummaryParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.operationsSummary(params),
    queryFn: () => getOperationsSummary(params),
    // Dashboard operacional: refresca sozinho para refletir Runs/eventos
    // recentes sem exigir F5 manual (seção 3).
    refetchInterval: 15000,
  });
}

export function useIncidents(params: ListIncidentsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.incidents(params),
    queryFn: () => listIncidents(params),
    placeholderData: keepPreviousData,
  });
}

export function useAuditLogs(params: ListAuditLogsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.auditLogs(params),
    queryFn: () => listAuditLogs(params),
    placeholderData: keepPreviousData,
  });
}

export function useJobRunDetail(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.jobRunDetail(id ?? 0),
    queryFn: () => getJobRunDetail(id as number),
    enabled: id !== null,
  });
}

export function useJobRunLineage(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.jobRunLineage(id ?? 0),
    queryFn: () => getJobRunLineage(id as number),
    enabled: id !== null,
  });
}

export function useGlobalAutonomy() {
  return useQuery({
    queryKey: queryKeys.agents.globalAutonomy,
    queryFn: () => getGlobalAutonomy(),
  });
}

export function useSetGlobalAutonomy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled: boolean) => setGlobalAutonomy(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.globalAutonomy });
      queryClient.invalidateQueries({ queryKey: ["agents", "operations", "summary"] });
    },
  });
}
