import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentsSubNav } from "@/components/agents/agents-sub-nav";
import { EventDetail } from "@/components/agents/events/event-detail";

export const metadata: Metadata = { title: "Evento de Agentes" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);

  if (!Number.isInteger(eventId) || eventId <= 0) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Evento #{eventId}</h1>
        <p className="text-sm text-muted-foreground">Payload, regras que casaram e Runs disparados.</p>
      </div>

      <AgentsSubNav />

      <EventDetail eventId={eventId} />
    </div>
  );
}
