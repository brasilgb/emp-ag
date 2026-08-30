"use client";

import { useState } from "react";
import { LayoutGrid, List, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PermissionGate } from "@/components/auth/permission-gate";
import { TaskBoard } from "@/components/projects/task-board";
import { TaskDetailSheet } from "@/components/projects/task-detail-sheet";
import { TaskForm } from "@/components/projects/task-form";
import { TaskListTable } from "@/components/projects/task-list-table";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCreateTask, useProjectTasks } from "@/hooks/projects/use-tasks";
import { TASK_STATUS_LABELS } from "@/lib/projects/format";
import type { TaskFormValues } from "@/lib/validation/projects-schema";
import { toErrorMessage } from "@/services/http";
import { TASK_STATUSES, type TaskStatus } from "@/types/projects";

type ViewMode = "board" | "list";

export function TasksTab({ projectId }: { projectId: number }) {
  const [view, setView] = useState<ViewMode>("board");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);

  const listQuery = useProjectTasks(projectId, {
    limit: 100,
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const createTask = useCreateTask(projectId);

  async function handleCreate(values: TaskFormValues) {
    try {
      await createTask.mutateAsync(values);
      toast.success("Tarefa criada.");
      setCreateOpen(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar tarefa."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("board")}
          >
            <LayoutGrid /> Board
          </Button>
          <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" onClick={() => setView("list")}>
            <List /> Lista
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {view === "list" ? (
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TaskStatus | "all")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {TASK_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {TASK_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <PermissionGate permission="tasks.create">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> Nova tarefa
            </Button>
          </PermissionGate>
        </div>
      </div>

      {view === "board" ? (
        <TaskBoard projectId={projectId} onOpenTask={setOpenTaskId} />
      ) : listQuery.isLoading ? (
        <LoadingState label="Carregando tarefas..." />
      ) : listQuery.isError || !listQuery.data ? (
        <ErrorState onRetry={() => listQuery.refetch()} />
      ) : listQuery.data.data.length === 0 ? (
        <EmptyState title="Nenhuma tarefa encontrada" description="Ajuste os filtros ou crie a primeira tarefa." />
      ) : (
        <TaskListTable tasks={listQuery.data.data} onOpenTask={setOpenTaskId} />
      )}

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Nova tarefa</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <TaskForm projectId={projectId} onSubmit={handleCreate} submitLabel="Criar tarefa" />
          </div>
        </SheetContent>
      </Sheet>

      <TaskDetailSheet
        projectId={projectId}
        taskId={openTaskId}
        open={openTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenTaskId(null);
        }}
      />
    </div>
  );
}
