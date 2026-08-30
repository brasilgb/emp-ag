"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ListApprovalsParams,
  approveApproval,
  listApprovals,
  rejectApproval,
} from "@/services/agents";

export function useAgentApprovals(params: ListApprovalsParams = {}) {
  return useQuery({
    queryKey: queryKeys.agents.approvals(params),
    queryFn: () => listApprovals(params),
    placeholderData: keepPreviousData,
  });
}

export function useApproveApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => approveApproval(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "approvals"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "executions"] });
    },
  });
}

export function useRejectApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) => rejectApproval(id, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "approvals"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "executions"] });
    },
  });
}
