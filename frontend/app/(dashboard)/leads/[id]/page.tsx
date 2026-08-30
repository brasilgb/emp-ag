import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LeadDetailPage } from "@/components/crm/lead-detail-page";

export const metadata: Metadata = { title: "Lead" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const leadId = Number(id);

  if (!Number.isInteger(leadId) || leadId <= 0) {
    notFound();
  }

  return <LeadDetailPage leadId={leadId} />;
}
