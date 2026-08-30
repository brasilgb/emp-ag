"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { createConversation, listConversations } from "@/services/agents";

export function useConversations(params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.agents.conversations(params),
    queryFn: () => listConversations(params),
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title?: string) => createConversation(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "conversations"] });
    },
  });
}
