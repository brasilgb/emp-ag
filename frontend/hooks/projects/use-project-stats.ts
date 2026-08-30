"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getProjectStats } from "@/services/project-stats";

export function useProjectStats() {
  return useQuery({
    queryKey: queryKeys.projects.stats,
    queryFn: () => getProjectStats(),
  });
}
