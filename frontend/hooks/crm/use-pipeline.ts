"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getPipeline } from "@/services/crm";

export function usePipeline() {
  return useQuery({
    queryKey: queryKeys.crm.pipeline,
    queryFn: getPipeline,
  });
}
