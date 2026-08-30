"use client";

import { AlertTriangle, Clock, ListTodo, Timer } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { useSupportStats } from "@/hooks/support/use-support-stats";
import { formatMinutes } from "@/lib/support/format";
import { useAuth } from "@/lib/auth/use-auth";

/**
 * Cards reais do módulo Suporte — GET /support/stats agrega tudo via SQL
 * (FILTER) no backend; aqui só exibimos os números prontos.
 *
 * `compact` (seção 47, dashboard geral): só "Chamados abertos"/"críticos"/
 * "atrasados" — a página /support (seção 38) usa o conjunto completo.
 */
export function SupportStatsCards({ compact = false }: { compact?: boolean }) {
  const { can } = useAuth();
  const canReadStats = can("support.stats.read");

  const statsQuery = useSupportStats();
  const stats = canReadStats ? statsQuery.data : undefined;

  const fullItems = [
    { label: "Chamados abertos", icon: ListTodo, value: stats?.open },
    { label: "Em atendimento", icon: Clock, value: stats?.inProgress },
    { label: "Aguardando cliente", icon: Clock, value: stats?.waitingCustomer },
    { label: "Críticos", icon: AlertTriangle, value: stats?.critical },
    { label: "Atrasados", icon: AlertTriangle, value: stats?.overdue },
    { label: "Resolvidos no mês", icon: ListTodo, value: stats?.resolvedThisMonth },
    {
      label: "1ª resposta (média)",
      icon: Timer,
      value: stats ? formatMinutes(stats.averageFirstResponseMinutes) : undefined,
    },
    {
      label: "Resolução (média)",
      icon: Timer,
      value: stats ? formatMinutes(stats.averageResolutionMinutes) : undefined,
    },
  ];

  const compactItems = [
    { label: "Chamados abertos", icon: ListTodo, value: stats?.open },
    { label: "Chamados críticos", icon: AlertTriangle, value: stats?.critical },
    { label: "Chamados atrasados", icon: AlertTriangle, value: stats?.overdue },
  ];

  const items = compact ? compactItems : fullItems;

  return (
    <>
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={item.value ?? "--"} icon={item.icon} />
      ))}
    </>
  );
}
