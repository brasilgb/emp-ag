import type { Milestone, MilestoneStatus } from "@/types/projects";

import { apiFetch } from "./http";

export interface MilestoneInput {
  name: string;
  description?: string;
  status?: MilestoneStatus;
  position?: number;
  dueDate?: string;
}

export function listMilestones(projectId: number): Promise<{ data: Milestone[] }> {
  return apiFetch(`/api/projects/${projectId}/milestones`);
}

export function createMilestone(
  projectId: number,
  input: MilestoneInput,
): Promise<{ data: Milestone }> {
  return apiFetch(`/api/projects/${projectId}/milestones`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMilestone(
  projectId: number,
  milestoneId: number,
  input: Partial<MilestoneInput>,
): Promise<{ data: Milestone }> {
  return apiFetch(`/api/projects/${projectId}/milestones/${milestoneId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
