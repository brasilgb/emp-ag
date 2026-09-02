import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { DirectorDashboard } from "@/components/agents/director/director-dashboard";

export const metadata: Metadata = { title: "Mesa do Diretor" };

export default function AgentDirectorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mesa do Diretor</h1>
        <p className="text-sm text-muted-foreground">
          O que precisa de atenção hoje, em CRM, Projetos, Financeiro, Suporte e na própria operação dos agentes.
        </p>
      </div>

      <AgentsSubNav />

      <DirectorDashboard />
    </div>
  );
}
