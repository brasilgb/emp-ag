"use client";

import { CalendarClock, User } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriorityBadge } from "@/components/projects/badges";
import { useAuth } from "@/lib/auth/use-auth";
import { isTaskOverdue } from "@/lib/projects/derived";
import { formatDate, TASK_STATUS_LABELS } from "@/lib/projects/format";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, type TaskListItem, type TaskStatus } from "@/types/projects";

export function TaskCard({
  task,
  onOpen,
  onStatusChange,
  isMoving,
}: {
  task: TaskListItem;
  onOpen: () => void;
  onStatusChange: (status: TaskStatus) => void;
  isMoving: boolean;
}) {
  const { can } = useAuth();
  const overdue = isTaskOverdue(task);

  return (
    <Card className={cn("gap-2 py-3", overdue && "border-destructive/50")}>
      <CardContent className="space-y-2 px-3">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full text-left text-sm font-medium hover:underline"
        >
          {task.title}
        </button>

        <div className="flex items-center justify-between text-xs">
          <PriorityBadge priority={task.priority} />
          {task.milestoneName ? (
            <span className="text-muted-foreground">{task.milestoneName}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="size-3" />
          {task.assigneeName ?? "Sem responsável"}
        </div>

        {task.dueDate ? (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            <CalendarClock className="size-3" />
            {formatDate(task.dueDate)}
            {overdue ? " · atrasada" : ""}
          </div>
        ) : null}

        <Select
          value={task.status}
          onValueChange={(value) => onStatusChange(value as TaskStatus)}
          disabled={isMoving || !(can("tasks.update") || can("tasks.complete"))}
        >
          <SelectTrigger size="sm" className="w-full text-xs" onClick={(event) => event.stopPropagation()}>
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
      </CardContent>
    </Card>
  );
}
