import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { RecoveryDashboard } from "@/components/agents/recovery/recovery-dashboard";

export const metadata: Metadata = { title: "Recovery de Workflows" };

export default function AgentsRecoveryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recovery de Workflows</h1>
        <p className="text-sm text-muted-foreground">
          Tela administrativa/operacional — detecta e reconcilia claims órfãos (Initiatives, Executive Reviews, Strategic Memories) que sobreviveram a um
          processo interrompido. Nunca é necessária para o uso diário do sistema.
        </p>
      </div>

      <AgentsSubNav />

      <RecoveryDashboard />
    </div>
  );
}
