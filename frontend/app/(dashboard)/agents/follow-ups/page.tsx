import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { FollowUpsList } from "@/components/agents/follow-ups/follow-ups-list";

export const metadata: Metadata = { title: "Follow-ups Operacionais" };

export default function AgentsFollowUpsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhamento estruturado de uma responsabilidade operacional até sua conclusão — quem é responsável, qual é o estado, qual é o prazo e
          qual foi a resolução. Um follow-up nunca executa uma ação — só organiza o acompanhamento.
        </p>
      </div>

      <AgentsSubNav />

      <FollowUpsList />
    </div>
  );
}
