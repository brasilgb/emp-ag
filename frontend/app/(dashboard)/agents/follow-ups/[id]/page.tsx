import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { FollowUpDetail } from "@/components/agents/follow-ups/follow-up-detail";

export const metadata: Metadata = { title: "FollowUp Operacional" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const followUpId = Number(id);

  if (!Number.isInteger(followUpId) || followUpId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">FollowUp #{followUpId}</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhamento operacional e ações propostas para resolvê-lo — nenhuma ação é executada aqui, apenas planejada e submetida ao pipeline
          oficial.
        </p>
      </div>

      <AgentsSubNav />

      <FollowUpDetail followUpId={followUpId} />
    </div>
  );
}
