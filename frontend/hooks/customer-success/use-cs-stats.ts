"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getStats } from "@/services/customer-success";

export function useCSStats() {
  return useQuery({
    queryKey: queryKeys.customerSuccess.stats,
    queryFn: () => getStats(),
  });
}
