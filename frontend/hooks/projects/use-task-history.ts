"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { listProjectHistory, listTaskHistory } from "@/services/task-history";

export function useTaskHistory(projectId: number, taskId: number) {
  return useQuery({
    queryKey: queryKeys.projects.taskHistory(projectId, taskId),
    queryFn: () => listTaskHistory(projectId, taskId),
    enabled: Number.isFinite(projectId) && Number.isFinite(taskId),
  });
}

export function useProjectHistory(projectId: number, page = 1) {
  return useQuery({
    queryKey: queryKeys.projects.history(projectId, { page }),
    queryFn: () => listProjectHistory(projectId, { page }),
    enabled: Number.isFinite(projectId),
  });
}
