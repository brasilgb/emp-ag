"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PriorityBadge, TaskStatusBadge } from "@/components/projects/badges";
import { TaskCommentsSection } from "@/components/projects/task-comments-section";
import { TaskForm } from "@/components/projects/task-form";
import { TaskHistorySection } from "@/components/projects/task-history-section";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useTask, useUpdateTask } from "@/hooks/projects/use-tasks";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { useAuth } from "@/lib/auth/use-auth";
import { formatDate, formatDateTime, TASK_STATUS_LABELS } from "@/lib/projects/format";
import { toErrorMessage } from "@/services/http";
import type { TaskFormValues } from "@/lib/validation/projects-schema";
import { TASK_STATUSES, type TaskStatus } from "@/types/projects";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function TaskDetailSheet({
  projectId,
  taskId,
  open,
  onOpenChange,
}: {
  projectId: number;
  taskId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { can } = useAuth();

  const taskQuery = useTask(projectId, taskId ?? Number.NaN);
  const usersQuery = useUsersDirectory();
  const updateTask = useUpdateTask(projectId, taskId ?? Number.NaN);

  async function handleQuickStatus(status: TaskStatus) {
    try {
      await updateTask.mutateAsync({ status });
      toast.success("Status atualizado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar status."));
    }
  }

  async function handleQuickAssignee(value: string | null) {
    try {
      await updateTask.mutateAsync({
        assigneeUserId: !value || value === "none" ? undefined : Number(value),
      });
      toast.success("Responsável atualizado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar responsável."));
    }
  }

  async function handleFullUpdate(values: TaskFormValues) {
    try {
      await updateTask.mutateAsync(values);
      toast.success("Tarefa atualizada.");
      setEditing(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar tarefa."));
    }
  }

  const task = taskQuery.data?.data;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setEditing(false);
        onOpenChange(next);
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{task ? task.title : "Tarefa"}</SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-6">
          {taskQuery.isLoading ? (
            <LoadingState label="Carregando tarefa..." />
          ) : taskQuery.isError || !task ? (
            <ErrorState onRetry={() => taskQuery.refetch()} />
          ) : (
            <Tabs defaultValue="detalhes">
              <TabsList>
                <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
                <TabsTrigger value="comentarios">Comentários</TabsTrigger>
                <TabsTrigger value="historico">Histórico</TabsTrigger>
              </TabsList>

              <TabsContent value="detalhes" className="mt-4 space-y-4">
                {editing ? (
                  <TaskForm
                    projectId={projectId}
                    defaultValues={{
                      title: task.title,
                      description: task.description ?? undefined,
                      status: task.status,
                      priority: task.priority,
                      assigneeUserId: task.assigneeUserId ?? undefined,
                      milestoneId: task.milestoneId ?? undefined,
                      executionType: task.executionType,
                      dueDate: task.dueDate ?? undefined,
                      estimatedHours: task.estimatedHours ? Number(task.estimatedHours) : undefined,
                    }}
                    onSubmit={handleFullUpdate}
                    submitLabel="Salvar alterações"
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <TaskStatusBadge status={task.status} />
                        <PriorityBadge priority={task.priority} />
                      </div>
                      {can("tasks.update") ? (
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                          <Pencil /> Editar
                        </Button>
                      ) : null}
                    </div>

                    {(can("tasks.update") || can("tasks.complete")) && (
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted-foreground">Status</span>
                        <Select
                          value={task.status}
                          onValueChange={(value) => handleQuickStatus(value as TaskStatus)}
                          disabled={updateTask.isPending}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TASK_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {TASK_STATUS_LABELS[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {(can("tasks.update") || can("tasks.assign")) && (
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted-foreground">Responsável</span>
                        <Select
                          value={task.assigneeUserId ? String(task.assigneeUserId) : "none"}
                          onValueChange={handleQuickAssignee}
                          disabled={updateTask.isPending || usersQuery.isLoading}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Sem responsável" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem responsável</SelectItem>
                            {usersQuery.data?.data.map((user) => (
                              <SelectItem key={user.id} value={String(user.id)}>
                                {user.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="divide-y">
                      <InfoRow label="Descrição" value={task.description ?? "--"} />
                      <InfoRow label="Milestone" value={task.milestoneName ?? "--"} />
                      <InfoRow label="Prazo" value={formatDate(task.dueDate)} />
                      <InfoRow label="Início" value={formatDateTime(task.startedAt)} />
                      <InfoRow label="Conclusão" value={formatDateTime(task.completedAt)} />
                      <InfoRow label="Horas estimadas" value={task.estimatedHours ?? "--"} />
                      <InfoRow label="Horas realizadas" value={task.actualHours ?? "--"} />
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="comentarios" className="mt-4">
                <TaskCommentsSection projectId={projectId} taskId={task.id} />
              </TabsContent>

              <TabsContent value="historico" className="mt-4">
                <TaskHistorySection projectId={projectId} taskId={task.id} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
