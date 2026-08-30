"use client";

import Link from "next/link";
import {
  CalendarClock,
  FileText,
  Handshake,
  Sparkles,
  Target,
  Trophy,
  Wallet,
  XCircle,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { usePipeline } from "@/hooks/crm/use-pipeline";
import { formatCurrency, formatDate } from "@/lib/crm/format";

export function CrmOverview() {
  const { data, isLoading, isError, refetch } = usePipeline();

  if (isLoading) {
    return <LoadingState label="Carregando indicadores do CRM..." />;
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  // Todos os indicadores abaixo vêm de GET /crm/pipeline (dado real, sem
  // valores inventados). Não existe ainda um endpoint agregado dedicado no
  // backend — os números são derivados aqui a partir da lista completa de
  // leads. Isso é aceitável no volume atual; se o número de leads crescer
  // muito, vale criar um endpoint de agregação (COUNT/SUM no Postgres) para
  // não trafegar a lista inteira só para montar estes cards.
  const allLeads = data.stages.flatMap((stage) => stage.leads);
  const openLeads = allLeads.filter((lead) => lead.status === "open");
  const newLeads = data.stages.find((stage) => stage.slug === "new")?.leads.length ?? 0;
  const proposalLeads = data.stages.find((stage) => stage.slug === "proposal")?.leads.length ?? 0;
  const negotiationLeads = data.stages.find((stage) => stage.slug === "negotiation")?.leads.length ?? 0;
  const wonLeads = allLeads.filter((lead) => lead.status === "won").length;
  const lostLeads = allLeads.filter((lead) => lead.status === "lost").length;

  const estimatedPipelineValue = openLeads.reduce(
    (sum, lead) => sum + Number(lead.estimatedValue ?? 0),
    0,
  );

  // Leads com próxima ação definida, ordenados pelos mais urgentes
  // (incluindo atrasados) primeiro. Evita comparar contra a hora atual
  // durante a renderização (o componente deve ser puro).
  const leadsWithNextAction = openLeads
    .filter((lead) => lead.nextActionAt)
    .sort((a, b) => new Date(a.nextActionAt!).getTime() - new Date(b.nextActionAt!).getTime());

  const stats = [
    { label: "Leads ativos", value: openLeads.length, icon: Target },
    { label: "Leads novos", value: newLeads, icon: Sparkles },
    { label: "Propostas", value: proposalLeads, icon: FileText },
    { label: "Negociações", value: negotiationLeads, icon: Handshake },
    { label: "Ganhos", value: wonLeads, icon: Trophy },
    { label: "Perdidos", value: lostLeads, icon: XCircle },
    { label: "Valor estimado do pipeline", value: formatCurrency(estimatedPipelineValue), icon: Wallet },
    { label: "Leads com próxima ação", value: leadsWithNextAction.length, icon: CalendarClock },
  ];

  const nextActions = leadsWithNextAction.slice(0, 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
        <p className="text-sm text-muted-foreground">Visão geral do funil comercial.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Próximas ações</CardTitle>
          <CardDescription>Leads em aberto com follow-up agendado, do mais urgente ao mais distante.</CardDescription>
        </CardHeader>
        <CardContent>
          {nextActions.length === 0 ? (
            <EmptyState
              title="Nenhuma ação agendada"
              description="Nenhum lead em aberto possui uma próxima ação registrada para os próximos dias."
            />
          ) : (
            <ul className="divide-y">
              {nextActions.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div className="min-w-0">
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.name}
                    </Link>
                    <p className="truncate text-muted-foreground">
                      {lead.nextActionDescription ?? "Sem descrição"}
                    </p>
                  </div>
                  <span className="shrink-0 text-muted-foreground">
                    {formatDate(lead.nextActionAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
