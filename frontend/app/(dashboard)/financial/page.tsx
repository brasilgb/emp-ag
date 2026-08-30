import type { Metadata } from "next";

import { EntriesPage } from "@/components/financial/entries-page";
import { FinancialStatsCards } from "@/components/financial/financial-stats-cards";

export const metadata: Metadata = { title: "Financeiro" };

export default function FinancialPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
        <p className="text-sm text-muted-foreground">Receitas, pendências e saúde financeira da agência.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FinancialStatsCards />
      </div>

      <EntriesPage />
    </div>
  );
}
