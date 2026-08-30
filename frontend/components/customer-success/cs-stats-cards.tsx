"use client";

import { AlertTriangle, Bell, HeartPulse, Rocket, Smile, Users } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { useCSStats } from "@/hooks/customer-success/use-cs-stats";
import { formatCurrency } from "@/lib/customer-success/format";
import { useAuth } from "@/lib/auth/use-auth";

/**
 * Cards reais do módulo Customer Success — GET /customer-success/stats
 * agrega tudo via SQL no backend.
 *
 * `compact` (seção 47, dashboard geral): só "Clientes em risco" — a página
 * /customer-success (seção 41) usa o conjunto completo.
 */
export function CsStatsCards({ compact = false }: { compact?: boolean }) {
  const { can } = useAuth();
  const canReadStats = can("cs.stats.read");

  const statsQuery = useCSStats();
  const stats = canReadStats ? statsQuery.data : undefined;

  const fullItems = [
    { label: "Contas ativas", icon: Users, value: stats?.activeAccounts },
    { label: "Em onboarding", icon: Rocket, value: stats?.onboarding },
    { label: "Em atenção", icon: AlertTriangle, value: stats?.attention },
    { label: "Em risco", icon: AlertTriangle, value: stats?.atRisk },
    { label: "Follow-ups vencidos", icon: Bell, value: stats?.followUpsDue },
    { label: "Health score médio", icon: HeartPulse, value: stats?.averageHealthScore },
    { label: "Satisfação média", icon: Smile, value: stats?.averageSatisfaction },
    {
      label: "Pipeline de expansão",
      icon: Rocket,
      value: stats ? formatCurrency(stats.expansionPipelineValue) : undefined,
    },
  ];

  const compactItems = [{ label: "Clientes em risco", icon: AlertTriangle, value: stats?.atRisk }];

  const items = compact ? compactItems : fullItems;

  return (
    <>
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value ?? "--"} icon={item.icon} />
      ))}
    </>
  );
}
