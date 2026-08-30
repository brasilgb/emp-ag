import type {
  ExecutionType,
  MilestoneStatus,
  Priority,
  ProjectStatus,
  TaskStatus,
} from "@/types/projects";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Rascunho",
  planned: "Planejado",
  in_progress: "Em andamento",
  on_hold: "Em espera",
  completed: "Concluído",
  cancelled: "Cancelado",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "A Fazer",
  in_progress: "Em Andamento",
  blocked: "Bloqueada",
  review: "Em Revisão",
  done: "Concluída",
  cancelled: "Cancelada",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  completed: "Concluído",
  cancelled: "Cancelado",
};

export const EXECUTION_TYPE_LABELS: Record<ExecutionType, string> = {
  human: "Humano",
  agent: "Agente",
  external: "Externo",
};

// Rótulos legíveis para os eventos de task_history / audit_logs exibidos na
// timeline do projeto e no histórico da tarefa.
export const HISTORY_EVENT_LABELS: Record<string, string> = {
  "task.created": "Tarefa criada",
  "task.updated": "Tarefa atualizada",
  "task.status_changed": "Status alterado",
  "task.assignee_changed": "Responsável alterado",
  "task.priority_changed": "Prioridade alterada",
  "task.completed": "Tarefa concluída",
  "task.reopened": "Tarefa reaberta",
  "task.comment.created": "Comentário adicionado",
  "project.created": "Projeto criado",
  "project.updated": "Projeto atualizado",
  "project.status_changed": "Status do projeto alterado",
  "milestone.created": "Milestone criado",
  "milestone.updated": "Milestone atualizado",
  "milestone.completed": "Milestone concluído",
};

export function historyEventLabel(event: string): string {
  return HISTORY_EVENT_LABELS[event] ?? event;
}

// Reexportados de lib/crm/format.ts para reuso — não duplicar formatação de
// moeda/data.
export { formatCurrency, formatDate, formatDateTime } from "@/lib/crm/format";
