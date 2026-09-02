"use client";

import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useOperationsSummary } from "@/hooks/agents/use-operations";
import { formatDateTime } from "@/lib/agents/format";

import { GlobalAutonomyToggle } from "./global-autonomy-toggle";
import { MetricCard } from "./metric-card";

// Agentes v1.6 (correio.md seção 3) — Operations Dashboard. Um único
// fetch (GET /agents/operations/summary), tudo já agregado no backend —
// nenhuma conta feita aqui.
export function OperationsDashboard() {
  const { data, isLoading, isError, refetch } = useOperationsSummary();

  if (isLoading) return <LoadingState label="Carregando dashboard operacional..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { jobs, runs, autonomous, events, approvals, period } = data.data;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Runs/eventos/autonomia no período de {formatDateTime(period.from)} até {formatDateTime(period.to)} — Jobs e
        Approvals são sempre totais.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          title="Jobs"
          rows={[
            { label: "Total", value: jobs.total },
            { label: "Ativos", value: jobs.active },
            { label: "Pausados", value: jobs.paused },
            { label: "Rascunho", value: jobs.draft },
            { label: "Concluídos", value: jobs.completed },
            { label: "Falharam", value: jobs.failed, emphasis: jobs.failed > 0 ? "warning" : "default" },
            { label: "Cancelados", value: jobs.cancelled },
            { label: "Autonomia desligada", value: jobs.autonomyDisabled },
            { label: "Circuit aberto", value: jobs.circuitOpen, emphasis: jobs.circuitOpen > 0 ? "danger" : "default" },
            { label: "Circuit meio-aberto", value: jobs.circuitHalfOpen, emphasis: jobs.circuitHalfOpen > 0 ? "warning" : "default" },
          ]}
        />

        <MetricCard
          title="Runs (no período)"
          rows={[
            { label: "Na fila", value: runs.queued },
            { label: "Planejando", value: runs.planning },
            { label: "Rodando", value: runs.running },
            { label: "Aguardando aprovação", value: runs.waitingApproval },
            { label: "Concluídos", value: runs.completed },
            { label: "Parciais", value: runs.partial },
            { label: "Falharam", value: runs.failed, emphasis: runs.failed > 0 ? "warning" : "default" },
            { label: "Bloqueados", value: runs.blocked, emphasis: runs.blocked > 0 ? "danger" : "default" },
            { label: "Cancelados", value: runs.cancelled },
          ]}
        />

        <MetricCard
          title="Execuções autônomas bloqueadas (no período)"
          rows={[
            { label: "Total", value: autonomous.blockedTotal, emphasis: autonomous.blockedTotal > 0 ? "warning" : "default" },
            { label: "Ciclos detectados", value: autonomous.cycleDetected, emphasis: autonomous.cycleDetected > 0 ? "danger" : "default" },
            { label: "Rate limit", value: autonomous.rateLimited },
            { label: "Profundidade excedida", value: autonomous.depthExceeded },
            { label: "Orçamento da cadeia", value: autonomous.chainBudgetExceeded },
            { label: "Circuit aberto", value: autonomous.circuitOpenBlocks },
            { label: "Job com autonomia desligada", value: autonomous.jobDisabledBlocks },
          ]}
        />

        <MetricCard
          title="Eventos (no período)"
          rows={[
            { label: "Criados", value: events.created },
            { label: "Processados", value: events.processed },
            { label: "Pendentes", value: events.pending },
            { label: "Ignorados", value: events.ignored },
            { label: "Falharam", value: events.failed, emphasis: events.failed > 0 ? "warning" : "default" },
            { label: "Deliveries falhas", value: events.deliveriesFailed, emphasis: events.deliveriesFailed > 0 ? "warning" : "default" },
          ]}
        />

        <MetricCard
          title="Aprovações"
          rows={[
            { label: "Pendentes", value: approvals.pending, emphasis: approvals.pending > 0 ? "warning" : "default" },
            { label: "Aprovadas", value: approvals.approved },
            { label: "Rejeitadas", value: approvals.rejected },
            { label: "Expiradas", value: approvals.expired },
            { label: "Canceladas", value: approvals.cancelled },
          ]}
        />

        <GlobalAutonomyToggle />
      </div>
    </div>
  );
}
