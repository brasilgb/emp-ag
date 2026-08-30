import type { ProjectStats } from "@/types/projects";

import { apiFetch } from "./http";

export function getProjectStats(): Promise<{ data: ProjectStats }> {
  return apiFetch("/api/projects/stats");
}
