import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { DecisionDetail } from "@/components/agents/director/decision-detail";

export const metadata: Metadata = { title: "Item da Fila de Prioridades" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const decisionId = Number(id);

  if (!Number.isInteger(decisionId) || decisionId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Item #{decisionId}</h1>
        <p className="text-sm text-muted-foreground">Fila de Prioridades — Mesa do Diretor.</p>
      </div>

      <AgentsSubNav />

      <DecisionDetail decisionId={decisionId} />
    </div>
  );
}
