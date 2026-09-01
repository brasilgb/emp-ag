import type { Metadata } from "next";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { EventList } from "@/components/agents/events/event-list";

export const metadata: Metadata = { title: "Eventos de Agentes" };

export default function AgentEventsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <p className="text-sm text-muted-foreground">
          Eventos internos de negócio publicados pelos módulos do sistema — a origem de todo Job disparado automaticamente.
        </p>
      </div>

      <AgentsSubNav />

      <EventList />
    </div>
  );
}
