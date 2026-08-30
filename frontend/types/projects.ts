export const PROJECT_STATUSES = [
  "draft",
  "planned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

// Compartilhada entre projetos e tarefas.
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MILESTONE_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

// Ordem fixa usada pelo board — todas as colunas aparecem sempre, mesmo
// vazias (ver GET /projects/:id/board no backend).
export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const EXECUTION_TYPES = ["human", "agent", "external"] as const;
export type ExecutionType = (typeof EXECUTION_TYPES)[number];

export interface Project {
  id: number;
  clientId: number;
  clientName: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: Priority;
  ownerUserId: number | null;
  ownerName: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  // Vêm do backend como string (coluna numeric) para preservar precisão.
  estimatedValue: string | null;
  estimatedHours: string | null;
  progress: number;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectListItem = Omit<
  Project,
  "description" | "estimatedValue" | "estimatedHours" | "notes" | "createdBy"
>;

export interface Milestone {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  status: MilestoneStatus;
  position: number;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCounts {
  total: number;
  done: number;
  cancelled: number;
  byStatus: Record<string, number>;
}

export interface ProjectDetail extends Project {
  milestones: Milestone[];
  taskCounts: TaskCounts;
}

export interface Task {
  id: number;
  projectId: number;
  milestoneId: number | null;
  milestoneName: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  assigneeUserId: number | null;
  assigneeName: string | null;
  executionType: ExecutionType;
  executionRef: string | null;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  estimatedHours: string | null;
  actualHours: string | null;
  position: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskListItem = Omit<
  Task,
  "description" | "executionRef" | "createdBy"
>;

export interface TaskComment {
  id: number;
  taskId: number;
  userId: number | null;
  authorName: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskHistoryEntry {
  id: number;
  taskId: number;
  actorType: string;
  actorId: string | null;
  event: string;
  oldData: unknown;
  newData: unknown;
  metadata: unknown;
  createdAt: string;
}

// Linha da timeline agregada de GET /projects/:id/history — une audit_logs
// (projeto/milestones/comentários) com task_history (eventos finos de
// tarefa).
export interface ProjectTimelineEntry {
  source: "audit" | "task_history";
  event: string;
  actorType: string;
  actorId: string | null;
  oldData: unknown;
  newData: unknown;
  metadata: unknown;
  createdAt: string;
}

export interface BoardColumn {
  status: TaskStatus;
  label: string;
  tasks: TaskListItem[];
}

export interface BoardData {
  columns: BoardColumn[];
}

export interface ProjectStats {
  activeProjects: number;
  overdueProjects: number;
  openTasks: number;
  overdueTasks: number;
  inReviewTasks: number;
}
