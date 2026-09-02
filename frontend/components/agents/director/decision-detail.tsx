"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { useAcknowledgeDecision, useDirectorDecision, useProposeDecisionAction } from "@/hooks/agents/use-director-decisions";
import {
  approvalState,
  canProposeActionForDecision,
  daysOpen,
  decisionImpactLabel,
  decisionUrgencyLabel,
  isDecisionClosed,
  signalDomainLabel,
  signalEntityHref,
  signalSeverityLabel,
} from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";

import { ApprovalStateBadge, DecisionStatusBadge } from "../status-badge";

/**
 * Agentes v1.9 (correio.md seção 27) — drill-down: origem, entidade,
 * fatores do score, ocorrências, Action Plan, approval, auditoria (via
 * link para a tela de audit logs existente), responsável, timestamps.
 * Reutiliza componentes já existentes (badges, links) — nenhuma view
 * paralela de plano/approval.
 */
export function DecisionDetail({ decisionId }: { decisionId: number }) {
  const { data, isLoading, isError, refetch } = useDirectorDecision(decisionId);
  const usersQuery = useUsersDirectory();
  const acknowledge = useAcknowledgeDecision();
  const propose = useProposeDecisionAction();

  if (isLoading) return <LoadingState label="Carregando item..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { decision, pendingApproval } = data.data;
  const entityHref = signalEntityHref({
    entityType: decision.entityType ?? undefined,
    entityId: decision.entityId ?? undefined,
    metadata: decision.metadata,
  });
  const userName = (userId: number | null) =>
    userId ? (usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`) : "--";

  async function handleAcknowledge() {
    try {
      await acknowledge.mutateAsync(decisionId);
      toast.success("Item reconhecido.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao reconhecer."));
    }
  }

  async function handlePropose() {
    try {
      const { data: result } = await propose.mutateAsync(decisionId);
      toast.success(`Plano #${result.plan.id} criado a partir do item.`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao propor ação."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <DecisionStatusBadge status={decision.status} />
            {decision.requiresHumanAttention ? (
              <Badge variant="secondary" className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400">
                Requer atenção humana
              </Badge>
            ) : null}
          </div>
          <PermissionGate permission="agents.director.decisions.manage">
            <div className="flex gap-2">
              {decision.status === "open" ? (
                <Button size="sm" variant="outline" disabled={acknowledge.isPending} onClick={handleAcknowledge}>
                  Reconhecer
                </Button>
              ) : null}
              {canProposeActionForDecision(decision.status) ? (
                <Button size="sm" disabled={propose.isPending} onClick={handlePropose}>
                  Propor ação
                </Button>
              ) : null}
            </div>
          </PermissionGate>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-sm font-medium">{decision.title}</p>
          <p className="text-sm text-muted-foreground">{decision.description}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Origem</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Domínio" value={signalDomainLabel(decision.domain)} />
            <Row label="Tipo de sinal" value={decision.signalType} />
            <Row label="Severidade" value={signalSeverityLabel(decision.severity)} />
            <Row
              label="Entidade"
              value={
                entityHref ? (
                  <Link href={entityHref} className="text-primary underline underline-offset-2">
                    Abrir {decision.entityType}
                  </Link>
                ) : (
                  decision.entityType ?? "--"
                )
              }
            />
            <Row label="Detectado pela primeira vez" value={formatDateTime(decision.firstDetectedAt)} />
            <Row label="Última detecção" value={formatDateTime(decision.lastDetectedAt)} />
            <Row label="Aberto há" value={`${daysOpen(decision.firstDetectedAt)} dia(s)`} />
            <Row label="Ocorrências" value={`${decision.occurrenceCount}x`} />
            <Row label="Responsável" value={userName(decision.assignedUserId)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Priorização (score: {decision.priorityScore})</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Impacto" value={decisionImpactLabel(decision.impact)} />
            <Row label="Urgência" value={decisionUrgencyLabel(decision.urgency)} />
            <Row label="Peso — severidade" value={decision.priorityFactors.severity.weight} />
            <Row label="Peso — impacto" value={decision.priorityFactors.impact.weight} />
            <Row label="Peso — urgência" value={decision.priorityFactors.urgency.weight} />
            <Row
              label="Peso — aging"
              value={`${decision.priorityFactors.aging.weight} (${decision.priorityFactors.aging.days}d)`}
            />
            <Row
              label="Peso — recorrência"
              value={`${decision.priorityFactors.recurrence.weight} (${decision.priorityFactors.recurrence.count}x)`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Action Plan</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {decision.actionPlanId ? (
              <Link
                href={`/agents/plans/${decision.actionPlanId}`}
                className="text-primary underline underline-offset-2"
              >
                Ver plano #{decision.actionPlanId}
              </Link>
            ) : (
              <p className="text-muted-foreground">Nenhum Action Plan proposto ainda.</p>
            )}
            {pendingApproval ? (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-muted-foreground">Approval:</span>
                <ApprovalStateBadge state={approvalState(pendingApproval)} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Ciclo de vida</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Reconhecido em" value={formatDateTime(decision.acknowledgedAt)} />
            <Row label="Reconhecido por" value={userName(decision.acknowledgedBy)} />
            {decision.status === "resolved" ? (
              <>
                <Row label="Resolvido em" value={formatDateTime(decision.resolvedAt)} />
                <Row label="Resolvido por" value={userName(decision.resolvedBy)} />
              </>
            ) : null}
            {isDecisionClosed(decision.status) && decision.status === "dismissed" ? (
              <>
                <Row label="Dispensado em" value={formatDateTime(decision.dismissedAt)} />
                <Row label="Dispensado por" value={userName(decision.dismissedBy)} />
                <Row label="Motivo" value={decision.dismissReason ?? "--"} />
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
