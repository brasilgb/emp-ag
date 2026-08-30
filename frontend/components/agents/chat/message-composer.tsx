"use client";

import { type FormEvent, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgentChat } from "@/hooks/agents/use-agent-chat";
import { toErrorMessage } from "@/services/http";

export function MessageComposer({
  conversationId,
  onSent,
}: {
  conversationId: number | null;
  onSent: (conversationId: number) => void;
}) {
  const [message, setMessage] = useState("");
  const chat = useAgentChat();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmed = message.trim();
    if (!trimmed) return;

    try {
      const response = await chat.mutateAsync({
        conversationId: conversationId ?? undefined,
        message: trimmed,
      });
      setMessage("");
      onSent(response.conversationId);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao enviar mensagem."));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t p-3">
      <Textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit(event);
          }
        }}
        placeholder="Pergunte algo ao Diretor Virtual..."
        className="min-h-10 flex-1"
        disabled={chat.isPending}
      />
      <Button type="submit" disabled={chat.isPending || !message.trim()}>
        <SendHorizontal className="size-4" />
        Enviar
      </Button>
    </form>
  );
}
