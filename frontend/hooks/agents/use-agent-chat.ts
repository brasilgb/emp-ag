"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { sendChatMessage } from "@/services/agents";

// Seção 33/44: dispara o pipeline completo (router → agente → tool) e
// invalida a conversa afetada + a lista de execuções (a tool executada
// gera uma execução rastreável — seção 41).
export function useAgentChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { conversationId?: number; message: string }) => sendChatMessage(input),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.conversation(response.conversationId) });
      queryClient.invalidateQueries({ queryKey: ["agents", "conversations"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "executions"] });
    },
  });
}
