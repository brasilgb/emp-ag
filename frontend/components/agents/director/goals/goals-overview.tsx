"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useDirectorGoalsOverview } from "@/hooks/agents/use-director-goals";
import { daysRemaining, goalPriorityLabel } from "@/lib/agents/derived";
import type { DirectorGoal } from "@/types/agents";

import { GoalHealthBadge } from "../../status-badge";
import { CreateGoalDialog } from "./create-goal-dialog";
import { GoalProgressBar } from "./progress-bar";

/**
 * Agentes v2.0 (correio.md seção 17/19) — "Objetivos Estratégicos": topo
 * da Mesa do Diretor. Mostra só os Goals ativos que precisam de atenção
 * (críticos/em risco/prazo perto/sem responsável) — nunca a lista
 * completa aqui (isso vive em /agents/director/goals).
 */
export function GoalsOverviewSection() {
  const { data, isLoading, isError, refetch } = useDirectorGoalsOverview();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) return <LoadingState label="Carregando objetivos estratégicos..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const overview = data.data;
  const highlighted = [...overview.critical, ...overview.atRisk].filter(
    (goal, index, all) => all.findIndex((other) => other.id === goal.id) === index,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Objetivos Estratégicos <span className="text-xs">({overview.activeTotal} ativos)</span>
        </h3>
        <div className="flex items-center gap-3">
          <Link href="/agents/director/goals" className="text-xs text-primary underline underline-offset-2">
            Ver todos
          </Link>
          <PermissionGate permission="agents.director.goals.manage">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Novo Goal
            </Button>
          </PermissionGate>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.activeTotal === 0 ? (
          <EmptyState title="Nenhum Goal ativo" description="Crie um objetivo estratégico para começar a acompanhar." className="py-8" />
        ) : highlighted.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todos os Goals ativos estão no caminho certo.</p>
        ) : (
          <ul className="space-y-3">
            {highlighted.slice(0, 5).map((goal) => (
              <GoalRow key={goal.id} goal={goal} />
            ))}
          </ul>
        )}
        {overview.deadlineNear.length > 0 ? (
          <p className="text-xs text-muted-foreground">{overview.deadlineNear.length} Goal(s) com prazo nos próximos 14 dias.</p>
        ) : null}
        {overview.withoutOwner.length > 0 ? (
          <p className="text-xs text-muted-foreground">{overview.withoutOwner.length} Goal(s) ativo(s) sem responsável.</p>
        ) : null}
      </CardContent>

      <CreateGoalDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Card>
  );
}

function GoalRow({ goal }: { goal: DirectorGoal }) {
  const remaining = daysRemaining(goal.targetDate);

  return (
    <li>
      <Link href={`/agents/director/goals/${goal.id}`} className="block space-y-1.5 rounded-md p-2 hover:bg-muted">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{goal.title}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{goalPriorityLabel(goal.priority)}</span>
            <GoalHealthBadge health={goal.health} />
          </div>
        </div>
        <GoalProgressBar percent={goal.progressPercent} health={goal.health} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{goal.progressPercent}% concluído</span>
          <span>{remaining >= 0 ? `${remaining}d restantes` : `${Math.abs(remaining)}d de atraso`}</span>
        </div>
      </Link>
    </li>
  );
}
