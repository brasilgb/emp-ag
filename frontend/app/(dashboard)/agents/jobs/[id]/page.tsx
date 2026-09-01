import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { JobDetail } from "@/components/agents/jobs/job-detail";

export const metadata: Metadata = { title: "Job de Agentes" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);

  if (!Number.isInteger(jobId) || jobId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Job #{jobId}</h1>
        <p className="text-sm text-muted-foreground">Cadeia Job → Run → Plano → Ações → Aprovação/Execução.</p>
      </div>

      <AgentsSubNav />

      <JobDetail jobId={jobId} />
    </div>
  );
}
