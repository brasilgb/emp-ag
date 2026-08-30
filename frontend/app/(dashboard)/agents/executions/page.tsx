import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { ExecutionList } from "@/components/agents/executions/execution-list";

export const metadata: Metadata = { title: "Execuções de Agentes" };

export default function AgentExecutionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Execuções</h1>
        <p className="text-sm text-muted-foreground">Histórico de execuções de ferramentas de agentes.</p>
      </div>

      <AgentsSubNav />

      <ExecutionList />
    </div>
  );
}
