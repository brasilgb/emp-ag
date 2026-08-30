import type { Metadata } from "next";

import { SupportStatsCards } from "@/components/support/support-stats-cards";
import { TicketsPage } from "@/components/support/tickets-page";

export const metadata: Metadata = { title: "Suporte" };

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SupportStatsCards />
      </div>

      <TicketsPage />
    </div>
  );
}
