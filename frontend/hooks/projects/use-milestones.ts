"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type MilestoneInput,
  createMilestone,
  listMilestones,
  updateMilestone,
} from "@/services/milestones";

export function useMilestones(projectId: number) {
  return useQuery({
    queryKey: queryKeys.projects.milestones(projectId),
    queryFn: () => listMilestones(projectId),
    enabled: Number.isFinite(projectId),
  });
}

export function useCreateMilestone(projectId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MilestoneInput) => createMilestone(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.milestones(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
  });
}

export function useUpdateMilestone(projectId: number, milestoneId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<MilestoneInput>) =>
      updateMilestone(projectId, milestoneId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.milestones(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
    },
  });
}
