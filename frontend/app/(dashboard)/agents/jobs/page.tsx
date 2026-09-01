import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { JobComposer } from "@/components/agents/jobs/job-composer";
import { JobList } from "@/components/agents/jobs/job-list";

export const metadata: Metadata = { title: "Jobs de Agentes" };

export default function AgentJobsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Objetivos operacionais persistentes, reexecutados de forma controlada e auditável ao longo do tempo.
        </p>
      </div>

      <AgentsSubNav />

      <JobComposer />

      <JobList />
    </div>
  );
}
