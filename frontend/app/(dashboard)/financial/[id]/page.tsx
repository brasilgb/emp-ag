import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EntryDetailPage } from "@/components/financial/entry-detail-page";

export const metadata: Metadata = { title: "Lançamento" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entryId = Number(id);

  if (!Number.isInteger(entryId) || entryId <= 0) {
    notFound();
  }

  return <EntryDetailPage entryId={entryId} />;
}
