import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { PlanComposer } from "@/components/agents/plans/plan-composer";
import { PlanList } from "@/components/agents/plans/plan-list";

export const metadata: Metadata = { title: "Planos de Ação de Agentes" };

export default function AgentActionPlansPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Planos de Ação</h1>
        <p className="text-sm text-muted-foreground">
          Objetivos transformados pelo Diretor Virtual em planos estruturados de ações, cada uma avaliada
          individualmente antes de executar.
        </p>
      </div>

      <AgentsSubNav />

      <PlanComposer />

      <PlanList />
    </div>
  );
}
