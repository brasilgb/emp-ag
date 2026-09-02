"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { useActivateGoal, useDirectorGoal, useEvaluateGoal, usePauseGoal } from "@/hooks/agents/use-director-goals";
import { daysRemaining, goalHealthLabel, goalPriorityLabel, isGoalClosed, signalDomainLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";

import { GoalHealthBadge, GoalStatusBadge, InitiativeStatusBadge } from "../../status-badge";
import { AddMetricDialog } from "./add-metric-dialog";
import { CancelGoalDialog } from "./cancel-goal-dialog";
import { CreateInitiativeDialog } from "./create-initiative-dialog";
import { GoalProgressBar } from "./progress-bar";

/**
 * Agentes v2.0 (correio.md seção 18) — painel executivo do Goal: título,
 * descrição, prioridade, owner, período, progresso, health, métricas,
 * histórico de avaliações, iniciativas vinculadas.
 */
export function GoalDetail({ goalId }: { goalId: number }) {
  const { data, isLoading, isError, refetch } = useDirectorGoal(goalId);
  const usersQuery = useUsersDirectory();
  const activate = useActivateGoal();
  const pause = usePauseGoal();
  const evaluate = useEvaluateGoal();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [addMetricOpen, setAddMetricOpen] = useState(false);
  const [createInitiativeOpen, setCreateInitiativeOpen] = useState(false);

  if (isLoading) return <LoadingState label="Carregando Goal..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { goal, metrics, evaluations, initiatives } = data.data;
  const remaining = daysRemaining(goal.targetDate);
  const userName = (userId: number | null) =>
    userId ? (usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`) : "--";

  async function handleActivate() {
    try {
      await activate.mutateAsync(goalId);
      toast.success("Goal ativado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao ativar Goal."));
    }
  }

  async function handlePause() {
    try {
      await pause.mutateAsync(goalId);
      toast.success("Goal pausado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao pausar Goal."));
    }
  }

  async function handleEvaluate() {
    try {
      await evaluate.mutateAsync(goalId);
      toast.success("Goal reavaliado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao avaliar Goal."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <GoalStatusBadge status={goal.status} />
            <GoalHealthBadge health={goal.health} />
            <Badge variant="secondary" className="border-transparent">
              {goalPriorityLabel(goal.priority)}
            </Badge>
          </div>
          <PermissionGate permission="agents.director.goals.manage">
            <div className="flex flex-wrap gap-2">
              {goal.status === "draft" || goal.status === "paused" ? (
                <Button size="sm" variant="outline" disabled={activate.isPending} onClick={handleActivate}>
                  Ativar
                </Button>
              ) : null}
              {goal.status === "active" ? (
                <Button size="sm" variant="outline" disabled={pause.isPending} onClick={handlePause}>
                  Pausar
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={evaluate.isPending} onClick={handleEvaluate}>
                Reavaliar agora
              </Button>
              {!isGoalClosed(goal.status) ? (
                <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </PermissionGate>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-sm font-medium">{goal.title}</p>
            <p className="text-sm text-muted-foreground">{goal.description}</p>
          </div>
          <GoalProgressBar percent={goal.progressPercent} health={goal.health} />
          <div className="flex flex-wrap items-center justify-between text-xs text-muted-foreground">
            <span>{goal.progressPercent}% concluído — {goalHealthLabel(goal.health)}</span>
            <span>{remaining >= 0 ? `${remaining} dia(s) restantes` : `${Math.abs(remaining)} dia(s) de atraso`}</span>
          </div>
          {goal.status === "cancelled" && goal.cancellationReason ? (
            <p className="text-xs text-muted-foreground">Motivo do cancelamento: {goal.cancellationReason}</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Informações</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Domínio" value={signalDomainLabel(goal.domain)} />
            <Row label="Responsável" value={userName(goal.ownerUserId)} />
            <Row label="Início" value={formatDateTime(goal.startDate)} />
            <Row label="Prazo" value={formatDateTime(goal.targetDate)} />
            <Row label="Última avaliação" value={formatDateTime(goal.lastEvaluatedAt)} />
            {goal.currentValue !== null && goal.targetValue !== null ? (
              <Row label="Valor atual / alvo" value={`${goal.currentValue}${goal.unit ? ` ${goal.unit}` : ""} / ${goal.targetValue}${goal.unit ? ` ${goal.unit}` : ""}`} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Métricas ({metrics.length})</h3>
            <PermissionGate permission="agents.director.goals.manage">
              <Button size="sm" variant="outline" onClick={() => setAddMetricOpen(true)}>
                Adicionar
              </Button>
            </PermissionGate>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {metrics.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma métrica associada.</p>
            ) : (
              metrics.map((metric) => (
                <div key={metric.id} className="flex items-center justify-between border-b pb-1 last:border-0">
                  <span>{metric.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {metric.currentValue ?? "--"} / {metric.targetValue} {metric.unit} (peso {metric.weight})
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Histórico de avaliações ({evaluations.length})</h3>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {evaluations.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma avaliação ainda.</p>
            ) : (
              [...evaluations]
                .reverse()
                .slice(0, 10)
                .map((evaluation) => (
                  <div key={evaluation.id} className="flex items-center justify-between border-b pb-1 text-xs last:border-0">
                    <span className="text-muted-foreground">{formatDateTime(evaluation.evaluatedAt)}</span>
                    <span>{evaluation.progressPercent}% — {goalHealthLabel(evaluation.health)}</span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Initiatives ({initiatives.length})</h3>
            <PermissionGate permission="agents.director.initiatives.manage">
              <Button size="sm" variant="outline" onClick={() => setCreateInitiativeOpen(true)}>
                Nova
              </Button>
            </PermissionGate>
          </CardHeader>
          <CardContent className="p-0">
            {initiatives.length === 0 ? (
              <EmptyState title="Nenhuma iniciativa" className="py-6" />
            ) : (
              <ul className="divide-y">
                {initiatives.map((initiative) => (
                  <li key={initiative.id} className="flex items-center justify-between p-3 text-sm">
                    <Link href={`/agents/director/initiatives/${initiative.id}`} className="text-primary underline-offset-2 hover:underline">
                      {initiative.title}
                    </Link>
                    <InitiativeStatusBadge status={initiative.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <CancelGoalDialog goalId={goalId} open={cancelOpen} onOpenChange={setCancelOpen} />
      <AddMetricDialog goalId={goalId} open={addMetricOpen} onOpenChange={setAddMetricOpen} />
      <CreateInitiativeDialog goalId={goalId} domain={goal.domain} open={createInitiativeOpen} onOpenChange={setCreateInitiativeOpen} />
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
