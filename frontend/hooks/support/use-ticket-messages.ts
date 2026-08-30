"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { type MessageInput, createMessage, listMessages } from "@/services/support";

export function useTicketMessages(ticketId: number, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.support.messages(ticketId, params),
    queryFn: () => listMessages(ticketId, params),
    enabled: Number.isFinite(ticketId),
  });
}

export function useCreateMessage(ticketId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MessageInput) => createMessage(ticketId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support", "tickets", ticketId] });
    },
  });
}
