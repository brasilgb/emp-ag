"use client";

import { useMemo, useState } from "react";

import { useAgents } from "@/hooks/agents/use-agents";

import { ConversationList } from "./conversation-list";
import { MessageComposer } from "./message-composer";
import { MessageThread } from "./message-thread";

export function ChatShell() {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const { data: agents } = useAgents();

  const agentNamesById = useMemo(() => {
    const map = new Map<number, string>();
    for (const agent of agents?.data ?? []) {
      map.set(agent.id, agent.name);
    }
    return map;
  }, [agents]);

  return (
    <div className="flex h-[calc(100vh-14rem)] min-h-[28rem] overflow-hidden rounded-lg border">
      <div className="w-64 shrink-0">
        <ConversationList selectedId={conversationId} onSelect={setConversationId} />
      </div>

      <div className="flex flex-1 flex-col">
        <MessageThread conversationId={conversationId} agentNamesById={agentNamesById} />
        <MessageComposer conversationId={conversationId} onSent={setConversationId} />
      </div>
    </div>
  );
}
