import type { Paginated } from "@/types/shared";
import type { ProjectTimelineEntry, TaskHistoryEntry } from "@/types/projects";

import { apiFetch, toQueryString } from "./http";

export interface ListHistoryParams {
  page?: number;
  limit?: number;
}

export function listTaskHistory(
  projectId: number,
  taskId: number,
  params: ListHistoryParams = {},
): Promise<Paginated<TaskHistoryEntry>> {
  return apiFetch(
    `/api/projects/${projectId}/tasks/${taskId}/history${toQueryString({ ...params })}`,
  );
}

// Timeline agregada do projeto (projeto + milestones + tarefas +
// comentários) — ver GET /projects/:id/history no backend.
export function listProjectHistory(
  projectId: number,
  params: ListHistoryParams = {},
): Promise<Paginated<ProjectTimelineEntry>> {
  return apiFetch(`/api/projects/${projectId}/history${toQueryString({ ...params })}`);
}
