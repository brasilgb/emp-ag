import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { ResponsibilitiesList } from "@/components/agents/responsibilities/responsibilities-list";

export const metadata: Metadata = { title: "Responsibilities de Agentes" };

export default function AgentsResponsibilitiesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Responsibilities</h1>
        <p className="text-sm text-muted-foreground">
          Quem é responsável por observar cada domínio da empresa e para quem escalar quando algo precisa de atenção. Uma Responsibility nunca concede
          permissão de executar — só define ownership operacional.
        </p>
      </div>

      <AgentsSubNav />

      <ResponsibilitiesList />
    </div>
  );
}
