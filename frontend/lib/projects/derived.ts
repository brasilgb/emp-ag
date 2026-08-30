import type { ProjectStatus, TaskStatus } from "@/types/projects";

/**
 * "Atrasada"/"atrasado" são condições derivadas (due_date < hoje AND status
 * em aberto) — nunca um status novo no banco. Comparação por data (sem
 * horário) para que "vence hoje" nunca conte como atrasado.
 */
function isPastDue(dueDate: string | null, today: Date): boolean {
  if (!dueDate) return false;

  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return due.getTime() < startOfToday.getTime();
}

const OPEN_TASK_STATUSES: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "review",
];

const OPEN_PROJECT_STATUSES: ProjectStatus[] = [
  "draft",
  "planned",
  "in_progress",
  "on_hold",
];

export function isTaskOverdue(
  task: { dueDate: string | null; status: TaskStatus },
  today: Date = new Date(),
): boolean {
  return OPEN_TASK_STATUSES.includes(task.status) && isPastDue(task.dueDate, today);
}

export function isProjectOverdue(
  project: { dueDate: string | null; status: ProjectStatus },
  today: Date = new Date(),
): boolean {
  return OPEN_PROJECT_STATUSES.includes(project.status) && isPastDue(project.dueDate, today);
}
