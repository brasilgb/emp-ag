import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { AuditLogList } from "@/components/agents/audit/audit-log-list";

export const metadata: Metadata = { title: "Auditoria de Agentes" };

export default function AgentAuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Trilha completa de ações administrativas e autônomas sobre agentes — quem fez o quê, e quando.
        </p>
      </div>

      <AgentsSubNav />

      <AuditLogList />
    </div>
  );
}
