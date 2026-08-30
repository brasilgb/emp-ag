import type { Metadata } from "next";

import { AgentList } from "@/components/agents/agent-list";
import { AgentsSubNav } from "@/components/agents/agents-sub-nav";

export const metadata: Metadata = { title: "Agentes" };

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
        <p className="text-sm text-muted-foreground">
          Diretor Virtual e agentes especializados por departamento.
        </p>
      </div>

      <AgentsSubNav />

      <AgentList />
    </div>
  );
}
