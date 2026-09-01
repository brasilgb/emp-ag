import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { RuleComposer } from "@/components/agents/event-rules/rule-composer";
import { RuleList } from "@/components/agents/event-rules/rule-list";

export const metadata: Metadata = { title: "Event Rules de Agentes" };

export default function EventRulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Event Rules</h1>
        <p className="text-sm text-muted-foreground">
          Associam um tipo de evento interno a um Job — quando um evento satisfaz os filtros, o Job dispara automaticamente.
        </p>
      </div>

      <AgentsSubNav />

      <RuleComposer />

      <RuleList />
    </div>
  );
}
