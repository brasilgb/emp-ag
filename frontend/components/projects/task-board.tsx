"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { TaskCard } from "@/components/projects/task-card";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useBoard } from "@/hooks/projects/use-tasks";
import { moveTaskBetweenColumns } from "@/lib/projects/board-helpers";
import { queryKeys } from "@/lib/query/keys";
import { updateTask } from "@/services/tasks";
import { toErrorMessage } from "@/services/http";
import type { BoardData, TaskStatus } from "@/types/projects";

/**
 * Board de tarefas por status. Sem drag-and-drop (não há lib no projeto e o
 * Kanban do CRM já optou por seletor — ver kanban-board.tsx) — a mudança de
 * coluna acontece pelo seletor de status no próprio card, com atualização
 * otimista e rollback em erro, mesmo padrão do Kanban de leads.
 */
export function TaskBoard({
  projectId,
  onOpenTask,
}: {
  projectId: number;
  onOpenTask: (taskId: number) => void;
}) {
  const { data, isLoading, isError, refetch } = useBoard(projectId);
  const queryClient = useQueryClient();
  const boardKey = queryKeys.projects.board(projectId);

  const moveMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: number; status: TaskStatus }) =>
      updateTask(projectId, taskId, { status }),

    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });

      const previous = queryClient.getQueryData<{ data: BoardData }>(boardKey);

      if (previous) {
        queryClient.setQueryData<{ data: BoardData }>(boardKey, {
          data: { columns: moveTaskBetweenColumns(previous.data.columns, taskId, status) },
        });
      }

      return { previous };
    },

    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(boardKey, context.previous);
      }

      toast.error(toErrorMessage(error, "Erro ao mover a tarefa. A posição anterior foi restaurada."));
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: boardKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.tasks(projectId) });
    },
  });

  if (isLoading) {
    return <LoadingState label="Carregando board..." />;
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {data.data.columns.map((column) => (
        <div key={column.status} className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">{column.label}</span>
            <Badge variant="secondary">{column.tasks.length}</Badge>
          </div>

          <div className="flex-1 space-y-2 p-2">
            {column.tasks.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">Nenhuma tarefa</p>
            ) : (
              column.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onOpen={() => onOpenTask(task.id)}
                  isMoving={moveMutation.isPending && moveMutation.variables?.taskId === task.id}
                  onStatusChange={(status) => moveMutation.mutate({ taskId: task.id, status })}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
