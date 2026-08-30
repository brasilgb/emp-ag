import type { Metadata } from "next";

import { AccountsPage } from "@/components/customer-success/accounts-page";
import { CsStatsCards } from "@/components/customer-success/cs-stats-cards";

export const metadata: Metadata = { title: "Customer Success" };

export default function CustomerSuccessPage() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CsStatsCards />
      </div>

      <AccountsPage />
    </div>
  );
}
