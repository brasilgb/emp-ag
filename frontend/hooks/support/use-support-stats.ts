"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getStats } from "@/services/support";

export function useSupportStats() {
  return useQuery({
    queryKey: queryKeys.support.stats,
    queryFn: () => getStats(),
  });
}
