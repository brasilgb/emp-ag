"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useOperationalControlCenter } from "@/hooks/agents/use-operations";
import { followUpPriorityLabel } from "@/lib/agents/derived";
import type { OperationalQueueItem, OperationalQueueName } from "@/types/agents";

import { FollowUpStatusBadge } from "../status-badge";
import { MetricCard } from "./metric-card";

const QUEUE_LABELS: Record<OperationalQueueName, string> = {
  needs_attention_now: "Precisa de atenção agora",
  awaiting_human: "Aguardando humano",
  failed: "Falhou",
  in_progress: "Em execução/acompanhamento",
  resolved_recently: "Resolvido recentemente",
};

const QUEUE_TONE: Record<OperationalQueueName, "default" | "warning" | "danger"> = {
  needs_attention_now: "danger",
  awaiting_human: "warning",
  failed: "danger",
  in_progress: "default",
  resolved_recently: "default",
};

const QUEUE_ORDER: OperationalQueueName[] = ["needs_attention_now", "failed", "awaiting_human", "in_progress", "resolved_recently"];

/**
 * Agentes v3.0 (correio.md "Etapa 2") — Operational Control Center.
 * Evolui a MESMA página de Operações já existente (v1.6/v2.5) — nunca uma
 * navegação paralela. Overview reusa `MetricCard`, o mesmo bloco já usado
 * pelo `OperationsDashboard` ao lado; as filas são listas de FollowUps
 * (o caso operacional central da cadeia Responsibility → ... →
 * Approval), cada linha levando para a página real do FollowUp
 * (drill-down, "Etapa 4" — nunca duplica a tela do FollowUp aqui).
 *
 * Critérios de fila (determinísticos, nunca "prioridade de IA") estão
 * documentados em `agents/operations/control-center-service.ts`
 * (`getOperationalQueues`) — o mesmo texto do `reason` de cada item vem
 * de lá, nunca reinventado no frontend.
 */
export function ControlCenterSection() {
  const { data, isLoading, isError, refetch } = useOperationalControlCenter();

  if (isLoading) return <LoadingState label="Carregando Control Center..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { overview, queues } = data.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          title="Cadeia operacional"
          rows={[
            { label: "Responsibilities ativas", value: overview.responsibilitiesActive },
            { label: "Escalations abertas", value: overview.escalationsOpen },
            { label: "Escalations sem FollowUp", value: overview.escalationsWithoutFollowUp, emphasis: overview.escalationsWithoutFollowUp > 0 ? "warning" : "default" },
            { label: "FollowUps abertos", value: overview.followUpsOpen },
            { label: "FollowUps vencidos", value: overview.followUpsOverdue, emphasis: overview.followUpsOverdue > 0 ? "danger" : "default" },
          ]}
        />

        <MetricCard
          title="Proposals, Action Plans e Approvals"
          rows={[
            { label: "Proposals submitted", value: overview.proposalsSubmitted },
            { label: "Proposals planned", value: overview.proposalsPlanned },
            { label: "Proposals failed", value: overview.proposalsFailed, emphasis: overview.proposalsFailed > 0 ? "warning" : "default" },
            { label: "Action Plans aguardando Approval", value: overview.actionPlansWaitingApproval },
            { label: "Action Plans parciais", value: overview.actionPlansPartial, emphasis: overview.actionPlansPartial > 0 ? "warning" : "default" },
            { label: "Action Plans falharam", value: overview.actionPlansFailed, emphasis: overview.actionPlansFailed > 0 ? "danger" : "default" },
            { label: "Approvals pendentes", value: overview.approvalsPending },
            { label: "Job Runs falharam (7d)", value: overview.jobRunsFailedRecent, emphasis: overview.jobRunsFailedRecent > 0 ? "warning" : "default" },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {QUEUE_ORDER.map((name) => (
          <OperationalQueueCard key={name} name={name} items={queues[name]} />
        ))}
      </div>
    </div>
  );
}

function OperationalQueueCard({ name, items }: { name: OperationalQueueName; items: OperationalQueueItem[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">{QUEUE_LABELS[name]}</h3>
        <Badge variant="secondary" className={QUEUE_TONE[name] === "danger" ? "bg-red-500/10 text-red-700 dark:text-red-400" : QUEUE_TONE[name] === "warning" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : ""}>
          {items.length}
        </Badge>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <EmptyState title="Vazio" description="Nenhum FollowUp nesta fila agora." />
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.followUpId} className="rounded-md border p-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link href={`/agents/follow-ups/${item.followUpId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {item.title}
                  </Link>
                  <FollowUpStatusBadge status={item.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Prioridade: {followUpPriorityLabel(item.priority)}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
