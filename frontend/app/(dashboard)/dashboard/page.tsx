import type { Metadata } from "next";
import { BadgeCheck, FileText, Target } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { ProjectStatsCards } from "@/components/dashboard/project-stats-cards";
import { FinancialStatsCards } from "@/components/financial/financial-stats-cards";
import { SupportStatsCards } from "@/components/support/support-stats-cards";
import { CsStatsCards } from "@/components/customer-success/cs-stats-cards";

export const metadata: Metadata = {
  title: "Dashboard",
};

// Indicadores sem endpoint agregado ainda — permanecem "--" até que o
// respectivo módulo (CRM avançado) tenha uma fonte real de dados. Ver
// correio.md item 44: só exibir dado real, nunca inventado. Os cards de
// Projetos/Tarefas, Financeiro, Suporte e Customer Success já têm dado real
// via <ProjectStatsCards />, <FinancialStatsCards compact />,
// <SupportStatsCards compact /> e <CsStatsCards compact /> — sem duplicar
// cards entre a home e a página de cada módulo (seções 33/47).
const STATS = [
  { label: "Leads ativos", icon: Target },
  { label: "Propostas abertas", icon: FileText },
  { label: "Aprovações pendentes", icon: BadgeCheck },
] as const;

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão geral</h1>
        <p className="text-sm text-muted-foreground">
          Resumo das operações da agência.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ProjectStatsCards />
        <FinancialStatsCards compact />
        <SupportStatsCards compact />
        <CsStatsCards compact />
        {STATS.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value="--" icon={stat.icon} />
        ))}
      </div>
    </div>
  );
}
