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
  useInitiativeExecution,
  useProposeInitiativeAction,
} from "@/hooks/agents/use-director-goals";
import { approvalState, canProposeActionForInitiative, goalPriorityLabel, signalDomainLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";
import type { InitiativeExecutionState, InitiativeExecutionView } from "@/types/agents";

import { ApprovalStateBadge, InitiativeExecutionStateBadge, InitiativeStatusBadge } from "../../status-badge";

/**
 * Agentes v2.0 (correio.md seção 16/21) — nunca executa nada
 * diretamente: "Propor ação" chama o pipeline oficial (mesmo componente
 * já usado pelo Decision Item na v1.9) e o resultado mostra a decisão
 * real do Policy Evaluator, nunca uma confirmação inventada na UI.
 */
export function InitiativeDetail({ initiativeId }: { initiativeId: number }) {
  const { data, isLoading, isError, refetch } = useDirectorInitiative(initiativeId);
  const executionQuery = useInitiativeExecution(initiativeId);
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
      toast.success(result.created ? `Plano #${result.plan.id} criado a partir da iniciativa.` : `Execução já em andamento — plano #${result.plan.id}.`);
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
              {initiative.status === "active" ? (
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

      {executionQuery.data ? <ExecutionCard view={executionQuery.data.data.execution} /> : null}

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

const EXECUTION_BAR_COLORS: Record<InitiativeExecutionState, string> = {
  not_started: "bg-muted-foreground/40",
  waiting_approval: "bg-amber-500",
  running: "bg-blue-500",
  blocked: "bg-amber-500",
  failed: "bg-red-500",
  completed: "bg-emerald-500",
};

/**
 * Agentes v2.1 (correio.md seção 14) — visão operacional da execução:
 * progresso real (não texto do LLM), itens concluídos/total, approvals
 * pendentes, bloqueios. Reaproveita o mesmo padrão visual da barra de
 * progresso de Goal (`GoalProgressBar`) — cores diferentes porque o
 * domínio é outro (execução, não saúde de Goal), mesma linguagem visual.
 */
function ExecutionCard({ view }: { view: InitiativeExecutionView }) {
  if (view.state === "not_started") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Execução</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Ainda não iniciada — nenhum Action Plan gerado.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Execução</h3>
        <InitiativeExecutionStateBadge state={view.state} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${EXECUTION_BAR_COLORS[view.state]}`}
            style={{ width: `${Math.max(0, Math.min(100, view.progressPercent))}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {view.completedItems} / {view.totalItems} ações concluídas
          </span>
          <span className="text-muted-foreground">{view.progressPercent}%</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {view.pendingApprovalItems > 0 ? <span>{view.pendingApprovalItems} aguardando aprovação</span> : null}
          {view.blockedItems > 0 ? <span>{view.blockedItems} bloqueada(s)</span> : null}
          {view.failedItems > 0 ? <span>{view.failedItems} com falha</span> : null}
          {view.shadowedItems > 0 ? <span>{view.shadowedItems} não executada(s) (shadow)</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
