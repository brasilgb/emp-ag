import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { RunDetail } from "@/components/agents/runs/run-detail";

export const metadata: Metadata = { title: "Execução de Agente" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);

  if (!Number.isInteger(runId) || runId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Execução #{runId}</h1>
        <p className="text-sm text-muted-foreground">
          Job → Run → Action Plan → Itens → Eventos → Runs causados, e a cadeia causal completa.
        </p>
      </div>

      <AgentsSubNav />

      <RunDetail runId={runId} />
    </div>
  );
}
