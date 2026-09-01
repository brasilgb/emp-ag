import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { PlanDetail } from "@/components/agents/plans/plan-detail";

export const metadata: Metadata = { title: "Plano de Ação de Agentes" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const planId = Number(id);

  if (!Number.isInteger(planId) || planId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plano de Ação #{planId}</h1>
        <p className="text-sm text-muted-foreground">Sequência de ações avaliadas pelo Diretor Virtual.</p>
      </div>

      <AgentsSubNav />

      <PlanDetail planId={planId} />
    </div>
  );
}
