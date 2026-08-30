import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClientDetailPage } from "@/components/crm/client-detail-page";

export const metadata: Metadata = { title: "Cliente" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = Number(id);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    notFound();
  }

  return <ClientDetailPage clientId={clientId} />;
}
