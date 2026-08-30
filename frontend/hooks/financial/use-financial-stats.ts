"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getStats } from "@/services/financial";

export function useFinancialStats() {
  return useQuery({
    queryKey: queryKeys.financial.stats,
    queryFn: () => getStats(),
  });
}
