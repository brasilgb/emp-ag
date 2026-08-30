import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountDetailPage } from "@/components/customer-success/account-detail-page";

export const metadata: Metadata = { title: "Conta de Customer Success" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const accountId = Number(id);

  if (!Number.isInteger(accountId) || accountId <= 0) {
    notFound();
  }

  return <AccountDetailPage accountId={accountId} />;
}
