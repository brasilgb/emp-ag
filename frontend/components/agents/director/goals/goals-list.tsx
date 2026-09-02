"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useDirectorGoals } from "@/hooks/agents/use-director-goals";
import { daysRemaining, goalPriorityLabel, signalDomainLabel } from "@/lib/agents/derived";
import { GOAL_HEALTHS, GOAL_STATUSES, type GoalHealth, type GoalStatus, type SignalDomain } from "@/types/agents";

import { GoalHealthBadge, GoalStatusBadge } from "../../status-badge";
import { CreateGoalDialog } from "./create-goal-dialog";
import { GoalProgressBar } from "./progress-bar";

const DOMAIN_OPTIONS: SignalDomain[] = ["crm", "projects", "finance", "support", "agents"];
const LIMIT = 20;

export function GoalsList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<GoalStatus | "all">("all");
  const [domain, setDomain] = useState<SignalDomain | "all">("all");
  const [health, setHealth] = useState<GoalHealth | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);

  const goals = useDirectorGoals({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
    domain: domain === "all" ? undefined : domain,
    health: health === "all" ? undefined : health,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as GoalStatus | "all");
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {GOAL_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={domain}
            onValueChange={(value) => {
              setPage(1);
              setDomain(value as SignalDomain | "all");
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os domínios</SelectItem>
              {DOMAIN_OPTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {signalDomainLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={health}
            onValueChange={(value) => {
              setPage(1);
              setHealth(value as GoalHealth | "all");
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda saúde</SelectItem>
              {GOAL_HEALTHS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <PermissionGate permission="agents.director.goals.manage">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Novo Goal
          </Button>
        </PermissionGate>
      </CardHeader>

      <CardContent className="p-0">
        {goals.isLoading ? (
          <LoadingState label="Carregando Goals..." />
        ) : goals.isError || !goals.data ? (
          <ErrorState onRetry={() => goals.refetch()} />
        ) : goals.data.data.length === 0 ? (
          <EmptyState title="Nenhum Goal encontrado" description="Ajuste os filtros ou crie um novo Goal." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Domínio</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Progresso</TableHead>
                  <TableHead>Saúde</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {goals.data.data.map((goal) => {
                  const remaining = daysRemaining(goal.targetDate);
                  return (
                    <TableRow key={goal.id}>
                      <TableCell className="max-w-64">
                        <Link href={`/agents/director/goals/${goal.id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                          {goal.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs">{signalDomainLabel(goal.domain)}</TableCell>
                      <TableCell className="text-xs">{goalPriorityLabel(goal.priority)}</TableCell>
                      <TableCell className="w-32">
                        <GoalProgressBar percent={goal.progressPercent} health={goal.health} />
                        <span className="text-xs text-muted-foreground">{goal.progressPercent}%</span>
                      </TableCell>
                      <TableCell>
                        <GoalHealthBadge health={goal.health} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {remaining >= 0 ? `${remaining}d restantes` : `${Math.abs(remaining)}d de atraso`}
                      </TableCell>
                      <TableCell>
                        <GoalStatusBadge status={goal.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {goals.data ? <PaginationBar pagination={goals.data.pagination} onPageChange={setPage} /> : null}
      </CardContent>

      <CreateGoalDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Card>
  );
}
