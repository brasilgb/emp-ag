import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { InitiativeDetail } from "@/components/agents/director/goals/initiative-detail";

export const metadata: Metadata = { title: "Initiative" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initiativeId = Number(id);

  if (!Number.isInteger(initiativeId) || initiativeId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Initiative #{initiativeId}</h1>
        <p className="text-sm text-muted-foreground">Linha de atuação vinculada a um Goal.</p>
      </div>

      <AgentsSubNav />

      <InitiativeDetail initiativeId={initiativeId} />
    </div>
  );
}
