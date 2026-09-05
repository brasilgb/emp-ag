"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ListAttentionQueueParams,
  type ListAuditLogsParams,
  type ListIncidentsParams,
  type ListSupervisionIncidentsParams,
  type ListSupervisionRunsParams,
  type OperationalSlaAnalyticsParams,
  type OperationsSummaryParams,
  type SupervisionInsightsPeriodParams,
  type UpdateIncidentReviewInput,
  assignIncident,
  deleteJobSetting,
  deleteSetting,
  getFollowUpTimeline,
  getGlobalAutonomy,
  getIncidentAssignment,
  getIncidentReview,
  getJobRunDetail,
  getJobRunLineage,
  getOperationalControlCenter,
  getOperationalOwnershipWorkload,
  getOperationalSlaAnalytics,
  getOperationsSummary,
  getSupervisionIncidentDetail,
  getSupervisionOverview,
  getSupervisionRun,
  listAttentionQueue,
  listAuditLogs,
  listIncidents,
  listJobSettings,
  listRecurringIncidents,
  listSettings,
  listSupervisionIncidents,
  listSupervisionRuns,
  setGlobalAutonomy,
  setJobSetting,
  setSetting,
  unassignIncident,
  updateIncidentReview,
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

// Agentes v3.0 — Operational Observability & Control Center (correio.md
// "Etapa 2"). Mesmo racional de refetch automático de useOperationsSummary
// acima — dashboard operacional, nunca exige F5 manual.
export function useOperationalControlCenter() {
  return useQuery({
    queryKey: queryKeys.agents.operationalControlCenter,
    queryFn: () => getOperationalControlCenter(),
    refetchInterval: 15000,
  });
}

// Agentes v3.4 — Operational Supervision Observability & Run History
// (correio.md). Histórico persistente — não precisa de refetch automático
// tipo dashboard (o usuário abre a aba de histórico para consultar, não
// para monitorar ao vivo); `keepPreviousData` evita flicker ao paginar.
export function useSupervisionRuns(params: ListSupervisionRunsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.supervisionRuns(params),
    queryFn: () => listSupervisionRuns(params),
    placeholderData: keepPreviousData,
  });
}

export function useSupervisionRun(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.supervisionRun(id ?? -1),
    queryFn: () => getSupervisionRun(id as number),
    enabled: id !== null,
  });
}

// Agentes v3.5 — Operational Supervision Insights & Incident Review
// (correio.md). Camada de leitura sobre v2.5/v2.6/v3.4 — mesmo racional
// de `useSupervisionRuns` acima (consulta pontual, não um dashboard ao
// vivo tipo useOperationsSummary; sem refetchInterval).
export function useSupervisionOverview(params: SupervisionInsightsPeriodParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.supervisionOverview(params),
    queryFn: () => getSupervisionOverview(params),
  });
}

export function useSupervisionIncidents(params: ListSupervisionIncidentsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.supervisionIncidents(params),
    queryFn: () => listSupervisionIncidents(params),
    placeholderData: keepPreviousData,
  });
}

export function useSupervisionIncidentDetail(auditLogId: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.supervisionIncidentDetail(auditLogId ?? -1),
    queryFn: () => getSupervisionIncidentDetail(auditLogId as number),
    enabled: auditLogId !== null,
  });
}

export function useRecurringIncidents(params: SupervisionInsightsPeriodParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.recurringIncidents(params),
    queryFn: () => listRecurringIncidents(params),
  });
}

// Agentes v3.7 — Operational Incident Review Queue & Attention Management
// (correio.md). Fila operacional — igual `useSupervisionIncidents` acima
// (`keepPreviousData` evita flicker ao paginar/filtrar).
export function useAttentionQueue(params: ListAttentionQueueParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.attentionQueue(params),
    queryFn: () => listAttentionQueue(params),
    placeholderData: keepPreviousData,
  });
}

// Agentes v3.6 — Operational Incident Acknowledgement & Review Workflow
// (correio.md). `useSupervisionIncidentDetail` já traz `data.review`
// completo — este hook fica para o caso raro de precisar só do review,
// sem o resto do detalhe do incidente.
export function useIncidentReview(auditLogId: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.incidentReview(auditLogId ?? -1),
    queryFn: () => getIncidentReview(auditLogId as number),
    enabled: auditLogId !== null,
  });
}

export function useUpdateIncidentReview(auditLogId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateIncidentReviewInput) => updateIncidentReview(auditLogId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.incidentReview(auditLogId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.supervisionIncidentDetail(auditLogId) });
      // Sem params: invalida QUALQUER variação de filtros já em cache
      // (mesmo padrão de useSetGlobalAutonomy abaixo) — a lista e o
      // overview mostram `reviewStatus`/`reviewsByStatus`, que acabaram
      // de mudar.
      queryClient.invalidateQueries({ queryKey: ["agents", "operations", "supervision-insights", "incidents"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "operations", "supervision-insights", "overview"] });
      // Agentes v3.7 — a fila Needs Attention é uma projeção do mesmo
      // review (correio.md: "manipular review através da v3.6 atualiza a
      // projeção da fila").
      queryClient.invalidateQueries({ queryKey: ["agents", "operations", "supervision-insights", "needs-attention"] });
      // Agentes v3.9 — a população ativa do workload usa a MESMA regra de
      // `reviewStatus` da fila (resolve/dismiss tiram o incidente da
      // população ativa).
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.ownershipWorkload });
    },
  });
}

// Agentes v3.8 — Operational Incident Ownership & Assignment (correio.md).
// `useSupervisionIncidentDetail` já traz `data.assignment` (via
// `SupervisionIncidentSummary`) — este hook fica para o caso raro de
// precisar só do assignment, mesmo racional de `useIncidentReview` acima.
export function useIncidentAssignment(auditLogId: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.incidentAssignment(auditLogId ?? -1),
    queryFn: () => getIncidentAssignment(auditLogId as number),
    enabled: auditLogId !== null,
  });
}

// Invalidação seguindo correio.md seção 18: "após assign/reassign/
// unassign, invalidar ao menos: attention queue, incident detail,
// incident history — somente nas chaves necessárias" (mesmas 3 chaves já
// invalidadas por `useUpdateIncidentReview` acima, nunca
// `window.location.reload()`).
function invalidateAfterAssignmentChange(queryClient: ReturnType<typeof useQueryClient>, auditLogId: number) {
  queryClient.invalidateQueries({ queryKey: queryKeys.agents.incidentAssignment(auditLogId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.agents.supervisionIncidentDetail(auditLogId) });
  queryClient.invalidateQueries({ queryKey: ["agents", "operations", "supervision-insights", "incidents"] });
  queryClient.invalidateQueries({ queryKey: ["agents", "operations", "supervision-insights", "needs-attention"] });
  // Agentes v3.9 — assign/reassign/unassign muda diretamente os
  // contadores de workload.
  queryClient.invalidateQueries({ queryKey: queryKeys.agents.ownershipWorkload });
}

// Agentes v3.9 — Operational Ownership Workload & Human Coordination
// Views (correio.md). Consulta pontual (o operador abre a seção para
// consultar, não um dashboard ao vivo) — mesmo racional de
// `useSupervisionOverview`, sem `refetchInterval`.
export function useOperationalOwnershipWorkload() {
  return useQuery({
    queryKey: queryKeys.agents.ownershipWorkload,
    queryFn: () => getOperationalOwnershipWorkload(),
  });
}

// Agentes v4.2 — Operational SLA Analytics & Performance Visibility
// (correio.md). Igual `useSupervisionOverview`/`useOperationalOwnershipWorkload`
// acima: consulta pontual sob demanda (o operador escolhe o período e
// consulta), nunca um dashboard ao vivo com `refetchInterval`.
// `keepPreviousData` evita flicker ao trocar de preset de período.
export function useOperationalSlaAnalytics(params: OperationalSlaAnalyticsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.slaAnalytics(params),
    queryFn: () => getOperationalSlaAnalytics(params),
    placeholderData: keepPreviousData,
  });
}

export function useAssignIncident(auditLogId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (assigneeUserId: number) => assignIncident(auditLogId, assigneeUserId),
    onSuccess: () => invalidateAfterAssignmentChange(queryClient, auditLogId),
  });
}

export function useUnassignIncident(auditLogId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => unassignIncident(auditLogId),
    onSuccess: () => invalidateAfterAssignmentChange(queryClient, auditLogId),
  });
}

// Agentes v3.0 — "Etapa 3" (timeline operacional).
export function useFollowUpTimeline(followUpId: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.followUpTimeline(followUpId ?? 0),
    queryFn: () => getFollowUpTimeline(followUpId as number),
    enabled: followUpId !== null,
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
