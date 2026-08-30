import type { Paginated } from "@/types/shared";
import type {
  BoardData,
  ExecutionType,
  Priority,
  Task,
  TaskListItem,
  TaskStatus,
} from "@/types/projects";

import { apiFetch, toQueryString } from "./http";

export interface ListTasksParams {
  page?: number;
  limit?: number;
  status?: TaskStatus;
  priority?: Priority;
  assignee?: number;
  milestone?: number;
  due?: string;
}

export interface TaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeUserId?: number;
  milestoneId?: number;
  executionType?: ExecutionType;
  dueDate?: string;
  estimatedHours?: number;
}

export interface TaskUpdateInput extends Partial<TaskInput> {
  actualHours?: number;
}

export function listProjectTasks(
  projectId: number,
  params: ListTasksParams = {},
): Promise<Paginated<TaskListItem>> {
  return apiFetch(`/api/projects/${projectId}/tasks${toQueryString({ ...params })}`);
}

export function getTask(projectId: number, taskId: number): Promise<{ data: Task }> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}`);
}

export function createTask(projectId: number, input: TaskInput): Promise<{ data: Task }> {
  return apiFetch(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTask(
  projectId: number,
  taskId: number,
  input: TaskUpdateInput,
): Promise<{ data: Task }> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getBoard(projectId: number): Promise<{ data: BoardData }> {
  return apiFetch(`/api/projects/${projectId}/board`);
}
