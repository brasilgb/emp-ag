"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { createTaskComment, listTaskComments } from "@/services/task-comments";

export function useTaskComments(projectId: number, taskId: number) {
  return useQuery({
    queryKey: queryKeys.projects.comments(projectId, taskId),
    queryFn: () => listTaskComments(projectId, taskId),
    enabled: Number.isFinite(projectId) && Number.isFinite(taskId),
  });
}

export function useCreateTaskComment(projectId: number, taskId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) => createTaskComment(projectId, taskId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.comments(projectId, taskId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.history(projectId) });
    },
  });
}
