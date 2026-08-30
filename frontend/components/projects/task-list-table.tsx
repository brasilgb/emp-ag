"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PriorityBadge, TaskStatusBadge, OverdueBadge } from "@/components/projects/badges";
import { isTaskOverdue } from "@/lib/projects/derived";
import { formatDate } from "@/lib/projects/format";
import type { TaskListItem } from "@/types/projects";

export function TaskListTable({
  tasks,
  onOpenTask,
}: {
  tasks: TaskListItem[];
  onOpenTask: (taskId: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Prioridade</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead>Milestone</TableHead>
            <TableHead>Prazo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id} className="cursor-pointer" onClick={() => onOpenTask(task.id)}>
              <TableCell className="font-medium">{task.title}</TableCell>
              <TableCell>
                <TaskStatusBadge status={task.status} />
              </TableCell>
              <TableCell>
                <PriorityBadge priority={task.priority} />
              </TableCell>
              <TableCell>{task.assigneeName ?? "--"}</TableCell>
              <TableCell>{task.milestoneName ?? "--"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {formatDate(task.dueDate)}
                  {isTaskOverdue(task) ? <OverdueBadge /> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
