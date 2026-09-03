"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getRecoveryStatus, getStaleWorkflows, reconcileWorkflow, runWorkflowRecovery } from "@/services/agents";
import type { WorkflowType } from "@/types/agents";

/**
 * Agentes v2.4 — Workflow Recovery, Reconciliation & Operational
 * Resilience (correio.md). Mesmo padrão dos demais hooks do módulo:
 * nenhuma mutação direta, toda ação passa pela rota do backend
 * correspondente e invalida as queries afetadas.
 */
export function useRecoveryStatus() {
  return useQuery({
    queryKey: queryKeys.agents.recoveryStatus,
    queryFn: () => getRecoveryStatus(),
  });
}

export function useStaleWorkflows() {
  return useQuery({
    queryKey: queryKeys.agents.recoveryStale,
    queryFn: () => getStaleWorkflows(),
  });
}

function useInvalidateRecovery() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.recoveryStatus });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.recoveryStale });
  };
}

export function useRunRecovery() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: (dryRun: boolean) => runWorkflowRecovery(dryRun),
    // dry-run não altera nada no backend — não precisa invalidar cache.
    onSuccess: (_, dryRun) => {
      if (!dryRun) invalidate();
    },
  });
}

export function useReconcileWorkflow() {
  const invalidate = useInvalidateRecovery();
  return useMutation({
    mutationFn: ({ type, id, dryRun }: { type: WorkflowType; id: number; dryRun: boolean }) => reconcileWorkflow(type, id, dryRun),
    onSuccess: (_, { dryRun }) => {
      if (!dryRun) invalidate();
    },
  });
}
