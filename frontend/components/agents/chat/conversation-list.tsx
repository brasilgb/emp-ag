"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { LoadingState } from "@/components/states/loading-state";
import { useConversations, useCreateConversation } from "@/hooks/agents/use-conversations";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/agents/format";

// Seção 39: lista de conversas + nova conversa.
export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const { data, isLoading } = useConversations({ limit: 50 });
  const createConversation = useCreateConversation();

  async function handleCreate() {
    const { data: conversation } = await createConversation.mutateAsync(undefined);
    onSelect(conversation.id);
  }

  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <span className="text-sm font-medium">Conversas</span>
        <Button size="icon-sm" variant="outline" onClick={handleCreate} disabled={createConversation.isPending}>
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <LoadingState label="Carregando..." />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title="Nenhuma conversa" description="Inicie uma nova conversa com o Diretor Virtual." />
        ) : (
          <ul className="divide-y">
            {data.data.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className={cn(
                    "w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted",
                    selectedId === conversation.id && "bg-muted",
                  )}
                >
                  <p className="truncate font-medium">{conversation.title ?? "Nova conversa"}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(conversation.updatedAt)}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
