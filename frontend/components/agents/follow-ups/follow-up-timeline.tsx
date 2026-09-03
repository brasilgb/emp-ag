"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useFollowUpTimeline } from "@/hooks/agents/use-operations";
import { formatDateTime } from "@/lib/agents/format";
import type { TimelineEvent } from "@/types/agents";

// `action` é um `varchar(100)` livre no audit log (nunca um enum
// fechado) — este mapa cobre só os eventos reais que aparecem na cadeia
// Responsibility → ... → Approval; qualquer ação fora daqui cai no
// fallback (o próprio `action`, formatado), nunca um erro.
const ACTION_LABELS: Record<string, string> = {
  "agents.responsibility.created": "Responsibility criada",
  "agents.operational_escalation.created": "Escalation criada",
  "agents.operational_escalation.acknowledged": "Escalation reconhecida",
  "agents.operational_escalation.resolved": "Escalation resolvida",
  "agents.operational_escalation.dismissed": "Escalation descartada",
  "agents.followups.created": "FollowUp criado",
  "agents.followups.started": "FollowUp iniciado",
  "agents.followups.waiting": "FollowUp aguardando",
  "agents.followups.resumed": "FollowUp retomado",
  "agents.followups.completed": "FollowUp concluído",
  "agents.followups.dismissed": "FollowUp descartado",
  "agents.operational_action.created": "Ação proposta",
  "agents.operational_action.submitted": "Proposta submetida",
  "agents.operational_action.planned": "Action Plan vinculado",
  "agents.operational_action.completed": "Proposta concluída",
  "agents.operational_action.failed": "Proposta falhou",
  "agents.operational_action.cancelled": "Proposta cancelada",
  "agent.plan.created": "Action Plan criado",
  "agent.plan.item.policy_decided": "Item avaliado pela Policy",
  "agent.plan.approval.requested": "Approval solicitada",
  "agent.plan.approval.approved": "Approval aprovada",
  "agent.plan.approval.rejected": "Approval rejeitada",
  "agent.plan.item.completed": "Item executado",
  "agent.plan.item.failed": "Item falhou",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/**
 * Agentes v3.0 (correio.md "Etapa 3") — timeline operacional derivada
 * 100% do audit log real (`GET /agents/follow-ups/:id/timeline`) —
 * nenhuma segunda fonte de histórico. Eventos de Action Plan/Item/
 * Approval só aparecem para quem tem `agents.plan.read` — decidido no
 * BACKEND (`control-center-service.ts:getFollowUpTimeline`), nunca
 * filtrado só aqui; se a lista vier sem esses eventos, é porque o
 * servidor já os removeu, não porque o componente escondeu algo.
 */
export function FollowUpTimeline({ followUpId }: { followUpId: number }) {
  const { data, isLoading, isError, refetch } = useFollowUpTimeline(followUpId);

  if (isLoading) return <LoadingState label="Carregando timeline..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const events = data.data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Timeline</h3>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState title="Sem eventos" description="Nenhum evento de auditoria encontrado para este FollowUp ainda." />
        ) : (
          <ol className="space-y-3 border-l pl-4">
            {events.map((event, index) => (
              <TimelineRow key={`${event.entityType}-${event.entityId}-${event.createdAt}-${index}`} event={event} />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineRow({ event }: { event: TimelineEvent }) {
  return (
    <li className="relative">
      <span className="absolute -left-[1.1rem] top-1 h-2 w-2 rounded-full bg-primary" />
      <p className="text-sm font-medium">{actionLabel(event.action)}</p>
      <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
    </li>
  );
}
