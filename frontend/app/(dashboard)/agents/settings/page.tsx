import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { SettingsList } from "@/components/agents/settings/settings-list";

export const metadata: Metadata = { title: "Configurações de Agentes" };

export default function AgentSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Circuit breaker, autonomia e limites operacionais dos agentes — persistidos, auditados e com origem sempre
          visível (Job, global ou default).
        </p>
      </div>

      <AgentsSubNav />

      <SettingsList />
    </div>
  );
}
