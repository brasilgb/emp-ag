"use client";

import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, TrendingUp, Wallet } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import { useFinancialStats } from "@/hooks/financial/use-financial-stats";
import { formatCurrency } from "@/lib/financial/format";
import { useAuth } from "@/lib/auth/use-auth";

/**
 * Cards reais do módulo Financeiro — GET /financial/stats agrega tudo via
 * SQL (FILTER) no backend; aqui só exibimos os números prontos, nunca
 * recalculamos indicadores no frontend.
 *
 * `compact` (seção 33, dashboard geral): mostra só 4 dos 7 indicadores para
 * não duplicar excesso de cards ao lado dos indicadores de CRM/Projetos. A
 * página /financial (seção 24) usa o conjunto completo.
 */
export function FinancialStatsCards({ compact = false }: { compact?: boolean }) {
  const { can } = useAuth();
  const canReadStats = can("financial.stats.read");

  const statsQuery = useFinancialStats();
  const stats = canReadStats ? statsQuery.data : undefined;

  const fullItems = [
    { label: "A receber", icon: ArrowUpCircle, value: stats?.receivablePending },
    { label: "A pagar", icon: ArrowDownCircle, value: stats?.payablePending },
    { label: "Recebido no mês", icon: Wallet, value: stats?.incomePaidThisMonth },
    { label: "Pago no mês", icon: Wallet, value: stats?.expensePaidThisMonth },
    { label: "Resultado do mês", icon: TrendingUp, value: stats?.resultThisMonth },
    { label: "Recebimentos atrasados", icon: AlertTriangle, value: stats?.overdueReceivable },
    { label: "Pagamentos atrasados", icon: AlertTriangle, value: stats?.overduePayable },
  ];

  const compactItems = [
    { label: "Receita recebida no mês", icon: Wallet, value: stats?.incomePaidThisMonth },
    { label: "Despesas pagas no mês", icon: Wallet, value: stats?.expensePaidThisMonth },
    { label: "Resultado do mês", icon: TrendingUp, value: stats?.resultThisMonth },
    { label: "A receber", icon: ArrowUpCircle, value: stats?.receivablePending },
  ];

  const items = compact ? compactItems : fullItems;

  return (
    <>
      {items.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={item.value !== undefined ? formatCurrency(item.value) : "--"}
          icon={item.icon}
        />
      ))}
    </>
  );
}
