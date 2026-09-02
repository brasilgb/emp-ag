"use client";

import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import {
  useApproveInitiative,
  useCompleteInitiative,
  useDirectorInitiative,
  useProposeInitiativeAction,
} from "@/hooks/agents/use-director-goals";
import { approvalState, canProposeActionForInitiative, goalPriorityLabel, isInitiativeClosed, signalDomainLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";

import { ApprovalStateBadge, InitiativeStatusBadge } from "../../status-badge";

/**
 * Agentes v2.0 (correio.md seção 16/21) — nunca executa nada
 * diretamente: "Propor ação" chama o pipeline oficial (mesmo componente
 * já usado pelo Decision Item na v1.9) e o resultado mostra a decisão
 * real do Policy Evaluator, nunca uma confirmação inventada na UI.
 */
export function InitiativeDetail({ initiativeId }: { initiativeId: number }) {
  const { data, isLoading, isError, refetch } = useDirectorInitiative(initiativeId);
  const usersQuery = useUsersDirectory();
  const approve = useApproveInitiative();
  const complete = useCompleteInitiative();
  const propose = useProposeInitiativeAction();

  if (isLoading) return <LoadingState label="Carregando Initiative..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { initiative, pendingApproval } = data.data;
  const userName = (userId: number | null) =>
    userId ? (usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`) : "--";

  async function handleApprove() {
    try {
      await approve.mutateAsync(initiativeId);
      toast.success("Initiative aprovada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao aprovar."));
    }
  }

  async function handleComplete() {
    try {
      await complete.mutateAsync(initiativeId);
      toast.success("Initiative concluída.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao concluir."));
    }
  }

  async function handlePropose() {
    try {
      const { data: result } = await propose.mutateAsync(initiativeId);
      toast.success(`Plano #${result.plan.id} criado a partir da iniciativa.`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao propor ação."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <InitiativeStatusBadge status={initiative.status} />
            <Badge variant="secondary" className="border-transparent">
              {goalPriorityLabel(initiative.priority)}
            </Badge>
            {initiative.origin === "director_recommendation" ? (
              <Badge variant="secondary" className="border-transparent bg-violet-500/10 text-violet-700 dark:text-violet-400">
                Recomendação do Diretor
              </Badge>
            ) : null}
          </div>
          <PermissionGate permission="agents.director.initiatives.manage">
            <div className="flex gap-2">
              {initiative.status === "proposed" ? (
                <Button size="sm" variant="outline" disabled={approve.isPending} onClick={handleApprove}>
                  Aprovar
                </Button>
              ) : null}
              {canProposeActionForInitiative(initiative.status) ? (
                <Button size="sm" disabled={propose.isPending} onClick={handlePropose}>
                  Propor ação
                </Button>
              ) : null}
              {(initiative.status === "approved" || initiative.status === "active") && !isInitiativeClosed(initiative.status) ? (
                <Button size="sm" variant="outline" disabled={complete.isPending} onClick={handleComplete}>
                  Concluir
                </Button>
              ) : null}
            </div>
          </PermissionGate>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <Link href={`/agents/director/goals/${initiative.goalId}`} className="text-xs text-primary underline underline-offset-2">
              Ver Goal #{initiative.goalId}
            </Link>
          </div>
          <p className="text-sm font-medium">{initiative.title}</p>
          <p className="text-sm text-muted-foreground">{initiative.description}</p>
          <p className="text-sm">
            <span className="text-muted-foreground">Racional: </span>
            {initiative.rationale}
          </p>
          {initiative.expectedImpact ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Impacto esperado: </span>
              {initiative.expectedImpact}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Informações</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Domínio" value={signalDomainLabel(initiative.domain)} />
            <Row label="Responsável" value={userName(initiative.ownerUserId)} />
            <Row label="Criada por" value={userName(initiative.createdBy)} />
            <Row label="Criada em" value={formatDateTime(initiative.createdAt)} />
            <Row label="Iniciada em" value={formatDateTime(initiative.startedAt)} />
            <Row label="Concluída em" value={formatDateTime(initiative.completedAt)} />
            {initiative.status === "cancelled" ? <Row label="Motivo do cancelamento" value={initiative.cancellationReason ?? "--"} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Action Plan</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {initiative.actionPlanId ? (
              <Link href={`/agents/plans/${initiative.actionPlanId}`} className="text-primary underline underline-offset-2">
                Ver plano #{initiative.actionPlanId}
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
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
