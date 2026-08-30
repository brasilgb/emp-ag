import type { DirectoryUser } from "@/types/users";

import { apiFetch } from "./http";

export function listUsersDirectory(): Promise<{ data: DirectoryUser[] }> {
  return apiFetch("/api/users");
}
