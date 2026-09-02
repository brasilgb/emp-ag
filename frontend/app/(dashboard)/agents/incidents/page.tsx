import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { IncidentList } from "@/components/agents/incidents/incident-list";

export const metadata: Metadata = { title: "Incidentes de Agentes" };

export default function AgentIncidentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Incidentes</h1>
        <p className="text-sm text-muted-foreground">
          Circuit breakers abertos, ciclos autônomos, limites excedidos e falhas repetidas — derivados dos dados
          existentes, sem sistema paralelo.
        </p>
      </div>

      <AgentsSubNav />

      <IncidentList />
    </div>
  );
}
