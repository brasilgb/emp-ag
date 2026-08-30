import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MILESTONE_STATUS_LABELS,
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/projects/format";
import type { MilestoneStatus, Priority, ProjectStatus, TaskStatus } from "@/types/projects";

const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  planned: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  on_hold: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  blocked: "bg-red-500/10 text-red-700 dark:text-red-400",
  review: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const MILESTONE_STATUS_STYLES: Record<MilestoneStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const PRIORITY_STYLES: Record<Priority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  high: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  urgent: "bg-red-500/10 text-red-700 dark:text-red-400",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", PROJECT_STATUS_STYLES[status])}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", TASK_STATUS_STYLES[status])}>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function MilestoneStatusBadge({ status }: { status: MilestoneStatus }) {
  return (
    <Badge
      variant="secondary"
      className={cn("border-transparent", MILESTONE_STATUS_STYLES[status])}
    >
      {MILESTONE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", PRIORITY_STYLES[priority])}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

export function OverdueBadge() {
  return (
    <Badge variant="secondary" className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400">
      Atrasado
    </Badge>
  );
}
