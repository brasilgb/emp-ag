import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { ChatShell } from "@/components/agents/chat/chat-shell";

export const metadata: Metadata = { title: "Chat de Agentes" };

export default function AgentChatPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <p className="text-sm text-muted-foreground">Converse com o Diretor Virtual e os agentes especializados.</p>
      </div>

      <AgentsSubNav />

      <ChatShell />
    </div>
  );
}
