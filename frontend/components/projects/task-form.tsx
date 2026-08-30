"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMilestones } from "@/hooks/projects/use-milestones";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/projects/format";
import {
  taskFormSchema,
  type TaskFormInput,
  type TaskFormValues,
} from "@/lib/validation/projects-schema";
import { PRIORITIES, TASK_STATUSES } from "@/types/projects";

interface TaskFormProps {
  projectId: number;
  defaultValues?: Partial<TaskFormInput>;
  onSubmit: (values: TaskFormValues) => Promise<void> | void;
  submitLabel?: string;
}

export function TaskForm({ projectId, defaultValues, onSubmit, submitLabel = "Salvar" }: TaskFormProps) {
  const milestonesQuery = useMilestones(projectId);
  const usersQuery = useUsersDirectory();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormInput, unknown, TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      status: "todo",
      priority: "normal",
      executionType: "human",
      title: "",
      ...defaultValues,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="task-title">Título</Label>
        <Input id="task-title" aria-invalid={!!errors.title} {...register("title")} />
        {errors.title ? <p className="text-xs text-destructive">{errors.title.message}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="task-status">Status</Label>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="task-status" className="w-full">
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
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="task-priority">Prioridade</Label>
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="task-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="task-assignee">Responsável</Label>
          <Controller
            control={control}
            name="assigneeUserId"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : "none"}
                onValueChange={(value) => field.onChange(value === "none" ? undefined : Number(value))}
                disabled={usersQuery.isLoading}
              >
                <SelectTrigger id="task-assignee" className="w-full">
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
            )}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="task-milestone">Milestone</Label>
          <Controller
            control={control}
            name="milestoneId"
            render={({ field }) => (
              <Select
                value={field.value ? String(field.value) : "none"}
                onValueChange={(value) => field.onChange(value === "none" ? undefined : Number(value))}
                disabled={milestonesQuery.isLoading}
              >
                <SelectTrigger id="task-milestone" className="w-full">
                  <SelectValue placeholder="Sem milestone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem milestone</SelectItem>
                  {milestonesQuery.data?.data.map((milestone) => (
                    <SelectItem key={milestone.id} value={String(milestone.id)}>
                      {milestone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="task-dueDate">Prazo</Label>
          <Input id="task-dueDate" type="date" {...register("dueDate")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-estimatedHours">Horas estimadas</Label>
          <Input id="task-estimatedHours" type="number" step="0.5" min="0" {...register("estimatedHours")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-description">Descrição</Label>
        <Textarea id="task-description" rows={3} {...register("description")} />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
