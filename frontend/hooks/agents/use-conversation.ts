"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { getConversation } from "@/services/agents";

export function useConversation(id: number | null) {
  return useQuery({
    queryKey: queryKeys.agents.conversation(id ?? 0),
    queryFn: () => getConversation(id as number),
    enabled: id !== null && Number.isFinite(id),
  });
}
