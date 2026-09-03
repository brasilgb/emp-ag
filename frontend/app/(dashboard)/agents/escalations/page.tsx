import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { EscalationsList } from "@/components/agents/escalations/escalations-list";

export const metadata: Metadata = { title: "Escalations Operacionais" };

export default function AgentsEscalationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Escalations</h1>
        <p className="text-sm text-muted-foreground">
          Escalonamentos formais gerados quando um domínio com Responsibility configurada precisa de atenção. Uma escalation nunca executa uma ação —
          só notifica o dono operacional real.
        </p>
      </div>

      <AgentsSubNav />

      <EscalationsList />
    </div>
  );
}
