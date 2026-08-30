import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TicketDetailPage } from "@/components/support/ticket-detail-page";

export const metadata: Metadata = { title: "Chamado" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticketId = Number(id);

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    notFound();
  }

  return <TicketDetailPage ticketId={ticketId} />;
}
