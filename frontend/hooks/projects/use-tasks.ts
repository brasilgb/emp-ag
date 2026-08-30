"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import {
  type ListTasksParams,
  type TaskInput,
  type TaskUpdateInput,
  createTask,
  getBoard,
  getTask,
  listProjectTasks,
  updateTask,
} from "@/services/tasks";

/**
 * progress/taskCounts do projeto são derivados das tarefas — qualquer
 * mutação de tarefa precisa invalidar também o detalhe e a lista de
 * projetos, senão esses valores ficam desatualizados na tela. Mesmo
 * princípio de invalidateLeadRelatedQueries em hooks/crm/use-leads.ts.
 */
function invalidateProjectRelatedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: number,
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.board(projectId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
  queryClient.invalidateQueries({ queryKey: ["projects", "list"] });
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.stats });
}

export function useProjectTasks(projectId: number, params: ListTasksParams = {}) {
  return useQuery({
    queryKey: queryKeys.projects.tasks(projectId, params),
    queryFn: () => listProjectTasks(projectId, params),
    enabled: Number.isFinite(projectId),
    placeholderData: keepPreviousData,
  });
}

export function useTask(projectId: number, taskId: number) {
  return useQuery({
    queryKey: queryKeys.projects.task(projectId, taskId),
    queryFn: () => getTask(projectId, taskId),
    enabled: Number.isFinite(projectId) && Number.isFinite(taskId),
  });
}

export function useBoard(projectId: number) {
  return useQuery({
    queryKey: queryKeys.projects.board(projectId),
    queryFn: () => getBoard(projectId),
    enabled: Number.isFinite(projectId),
  });
}

export function useCreateTask(projectId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TaskInput) => createTask(projectId, input),
    onSuccess: () => invalidateProjectRelatedQueries(queryClient, projectId),
  });
}

export function useUpdateTask(projectId: number, taskId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TaskUpdateInput) => updateTask(projectId, taskId, input),
    onSuccess: () => {
      invalidateProjectRelatedQueries(queryClient, projectId);
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.taskHistory(projectId, taskId) });
    },
  });
}
