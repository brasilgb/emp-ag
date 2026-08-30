import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { ApprovalList } from "@/components/agents/approvals/approval-list";

export const metadata: Metadata = { title: "Aprovações de Agentes" };

export default function AgentApprovalsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Aprovações</h1>
        <p className="text-sm text-muted-foreground">Ações sensíveis solicitadas por agentes, pendentes de decisão humana.</p>
      </div>

      <AgentsSubNav />

      <ApprovalList />
    </div>
  );
}
