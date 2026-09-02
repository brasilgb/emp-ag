import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { OperationsDashboard } from "@/components/agents/operations/operations-dashboard";

export const metadata: Metadata = { title: "Operações de Agentes" };

export default function AgentOperationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Operações</h1>
        <p className="text-sm text-muted-foreground">
          O que os agentes estão fazendo, o que falhou, o que foi bloqueado e o que aguarda intervenção.
        </p>
      </div>

      <AgentsSubNav />

      <OperationsDashboard />
    </div>
  );
}
