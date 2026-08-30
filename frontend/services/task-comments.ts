import type { Paginated } from "@/types/shared";
import type { TaskComment } from "@/types/projects";

import { apiFetch, toQueryString } from "./http";

export interface ListCommentsParams {
  page?: number;
  limit?: number;
}

export function listTaskComments(
  projectId: number,
  taskId: number,
  params: ListCommentsParams = {},
): Promise<Paginated<TaskComment>> {
  return apiFetch(
    `/api/projects/${projectId}/tasks/${taskId}/comments${toQueryString({ ...params })}`,
  );
}

export function createTaskComment(
  projectId: number,
  taskId: number,
  content: string,
): Promise<{ data: TaskComment }> {
  return apiFetch(`/api/projects/${projectId}/tasks/${taskId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}
