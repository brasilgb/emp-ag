"use client";

import { useEffect, useRef } from "react";

import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useConversation } from "@/hooks/agents/use-conversation";
import { cn } from "@/lib/utils";
import type { AgentMessage } from "@/types/agents";

import { ToolBadge } from "./tool-badge";

function MessageBubble({ message, agentName }: { message: AgentMessage; agentName: string | null }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {message.content}
      </div>
      {!isUser && message.metadata?.toolHandler ? (
        <ToolBadge agentName={agentName ?? "Agente"} toolHandler={message.metadata.toolHandler} />
      ) : null}
    </div>
  );
}

// Seção 39: mensagens, nome/avatar do agente que respondeu, tool
// utilizada, status de execução, erro amigável. Sem streaming nesta v1.
export function MessageThread({
  conversationId,
  agentNamesById,
}: {
  conversationId: number | null;
  agentNamesById: Map<number, string>;
}) {
  const { data, isLoading, isError, refetch } = useConversation(conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [data?.data.messages.length]);

  if (conversationId === null) {
    return (
      <EmptyState
        title="Selecione ou inicie uma conversa"
        description="Converse com o Diretor Virtual — ele decide qual agente especializado deve responder."
      />
    );
  }

  if (isLoading) {
    return <LoadingState label="Carregando conversa..." />;
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  if (data.data.messages.length === 0) {
    return <EmptyState title="Conversa vazia" description="Envie a primeira mensagem abaixo." />;
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4">
      {data.data.messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          agentName={message.agentId ? (agentNamesById.get(message.agentId) ?? null) : null}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
