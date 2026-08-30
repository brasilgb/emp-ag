import type { Paginated } from "@/types/shared";
import type { Priority, ProjectDetail, ProjectListItem, ProjectStatus } from "@/types/projects";

import { apiFetch, toQueryString } from "./http";

export interface ListProjectsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: ProjectStatus;
  priority?: Priority;
  client?: number;
  owner?: number;
}

export interface ProjectInput {
  clientId: number;
  name: string;
  description?: string;
  status?: ProjectStatus;
  priority?: Priority;
  ownerUserId?: number;
  startDate?: string;
  dueDate?: string;
  estimatedValue?: number;
  estimatedHours?: number;
  notes?: string;
}

export function listProjects(params: ListProjectsParams = {}): Promise<Paginated<ProjectListItem>> {
  return apiFetch(`/api/projects${toQueryString({ ...params })}`);
}

export function getProject(id: number): Promise<{ data: ProjectDetail }> {
  return apiFetch(`/api/projects/${id}`);
}

export function createProject(input: ProjectInput): Promise<{ data: ProjectListItem }> {
  return apiFetch("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProject(
  id: number,
  input: Partial<ProjectInput>,
): Promise<{ data: ProjectListItem }> {
  return apiFetch(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
