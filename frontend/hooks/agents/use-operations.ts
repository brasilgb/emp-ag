"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ListAuditLogsParams,
  type ListIncidentsParams,
  type OperationsSummaryParams,
  deleteJobSetting,
  deleteSetting,
  getGlobalAutonomy,
  getJobRunDetail,
  getJobRunLineage,
  getOperationsSummary,
  listAuditLogs,
  listIncidents,
  listJobSettings,
  listSettings,
  setGlobalAutonomy,
  setJobSetting,
  setSetting,
} from "@/services/agents";
import type { SettingKey } from "@/types/agents";

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

// Agentes v1.7 — Agent Management & Operational Configuration (correio.md).

export function useAgentSettings() {
  return useQuery({
    queryKey: queryKeys.agents.settings,
    queryFn: () => listSettings(),
  });
}

export function useJobSettings(jobId: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.jobSettings(jobId ?? 0),
    queryFn: () => listJobSettings(jobId as number),
    enabled: jobId !== null,
  });
}

export function useSetSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: number }) => setSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.settings });
      queryClient.invalidateQueries({ queryKey: ["agents", "operations", "summary"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "incidents"] });
    },
  });
}

export function useDeleteSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (key: SettingKey) => deleteSetting(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.settings });
      queryClient.invalidateQueries({ queryKey: ["agents", "operations", "summary"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "incidents"] });
    },
  });
}

export function useSetJobSetting(jobId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: number }) => setJobSetting(jobId, key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.jobSettings(jobId) });
    },
  });
}

export function useDeleteJobSetting(jobId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (key: SettingKey) => deleteJobSetting(jobId, key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.jobSettings(jobId) });
    },
  });
}
