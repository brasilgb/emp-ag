"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import {
  useAcknowledgeDecision,
  useDirectorDecisions,
  useDirectorDecisionsOverview,
  useProposeDecisionAction,
  useSyncDecisionQueue,
} from "@/hooks/agents/use-director-decisions";
import {
  canProposeActionForDecision,
  daysOpen,
  decisionImpactLabel,
  isDecisionClosed,
  signalDomainLabel,
} from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import {
  DECISION_STATUSES,
  type DecisionStatus,
  type DirectorDecision,
  type SignalDomain,
  type SignalSeverity,
} from "@/types/agents";

import { DecisionStatusBadge, SignalSeverityBadge } from "../status-badge";
import { AssignDecisionDialog } from "./assign-decision-dialog";
import { DismissDecisionDialog } from "./dismiss-decision-dialog";

const DOMAIN_OPTIONS: SignalDomain[] = ["crm", "projects", "finance", "support", "agents"];
const SEVERITY_OPTIONS: SignalSeverity[] = ["critical", "warning", "attention", "info"];
const LIMIT = 20;

/**
 * Agentes v1.9 (correio.md seção 25/26) — "Fila de Prioridades": expande a
 * Mesa do Diretor v1.8, nunca uma área desconectada. Resumo executivo
 * (seção 26) + lista filtrável + ações de ciclo de vida por permission.
 */
export function DecisionQueue() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<DecisionStatus | "all">("all");
  const [domain, setDomain] = useState<SignalDomain | "all">("all");
  const [severity, setSeverity] = useState<SignalSeverity | "all">("all");
  const [onlyHumanAttention, setOnlyHumanAttention] = useState(false);

  const overview = useDirectorDecisionsOverview();
  const usersQuery = useUsersDirectory();
  const decisions = useDirectorDecisions({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
    domain: domain === "all" ? undefined : domain,
    severity: severity === "all" ? undefined : severity,
    requiresHumanAttention: onlyHumanAttention || undefined,
  });

  const sync = useSyncDecisionQueue();
  const acknowledge = useAcknowledgeDecision();
  const propose = useProposeDecisionAction();

  const [assignTarget, setAssignTarget] = useState<number | null>(null);
  const [dismissTarget, setDismissTarget] = useState<number | null>(null);

  const userName = (userId: number | null) =>
    userId ? (usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`) : "--";

  async function handleSync() {
    try {
      const { data } = await sync.mutateAsync();
      toast.success(
        `Fila sincronizada: ${data.created} novos, ${data.updated} atualizados, ${data.resolved} resolvidos.`,
      );
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao sincronizar."));
    }
  }

  async function handleAcknowledge(id: number) {
    try {
      await acknowledge.mutateAsync(id);
      toast.success("Item reconhecido.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao reconhecer."));
    }
  }

  async function handlePropose(id: number) {
    try {
      const { data } = await propose.mutateAsync(id);
      toast.success(`Plano #${data.plan.id} criado a partir do item.`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao propor ação."));
    }
  }

  return (
    <div className="space-y-4">
      <OverviewStats overview={overview.data?.data} />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Fila de Prioridades</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(value) => {
                setPage(1);
                setStatus(value as DecisionStatus | "all");
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {DECISION_STATUSES.map((value) => (
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
              value={severity}
              onValueChange={(value) => {
                setPage(1);
                setSeverity(value as SignalSeverity | "all");
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda severidade</SelectItem>
                {SEVERITY_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={onlyHumanAttention ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setPage(1);
                setOnlyHumanAttention((value) => !value);
              }}
            >
              Requer atenção
            </Button>

            <PermissionGate permission="agents.director.decisions.manage">
              <Button variant="outline" size="sm" disabled={sync.isPending} onClick={handleSync}>
                Sincronizar
              </Button>
            </PermissionGate>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {decisions.isLoading ? (
            <LoadingState label="Carregando fila de prioridades..." />
          ) : decisions.isError || !decisions.data ? (
            <ErrorState onRetry={() => decisions.refetch()} />
          ) : decisions.data.data.length === 0 ? (
            <EmptyState title="Nada na fila" description="Nenhum item corresponde aos filtros selecionados." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Severidade</TableHead>
                    <TableHead>Domínio</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Aberto há</TableHead>
                    <TableHead>Ocorrências</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {decisions.data.data.map((decision: DirectorDecision) => (
                    <TableRow key={decision.id}>
                      <TableCell className="tabular-nums">{decision.priorityScore}</TableCell>
                      <TableCell>
                        <SignalSeverityBadge severity={decision.severity} />
                      </TableCell>
                      <TableCell className="text-xs">{signalDomainLabel(decision.domain)}</TableCell>
                      <TableCell className="max-w-64">
                        <Link
                          href={`/agents/director/decisions/${decision.id}`}
                          className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {decision.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          {decision.requiresHumanAttention ? (
                            <Badge variant="secondary" className="border-transparent bg-red-500/10 text-red-700 dark:text-red-400">
                              Requer atenção
                            </Badge>
                          ) : null}
                          <span className="text-xs text-muted-foreground">
                            Impacto {decisionImpactLabel(decision.impact).toLowerCase()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{daysOpen(decision.firstDetectedAt)}d</TableCell>
                      <TableCell className="tabular-nums text-xs">{decision.occurrenceCount}x</TableCell>
                      <TableCell className="text-xs">{userName(decision.assignedUserId)}</TableCell>
                      <TableCell>
                        <DecisionStatusBadge status={decision.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PermissionGate permission="agents.director.decisions.manage">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {decision.status === "open" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={acknowledge.isPending}
                                onClick={() => handleAcknowledge(decision.id)}
                              >
                                Reconhecer
                              </Button>
                            ) : null}
                            {!isDecisionClosed(decision.status) ? (
                              <Button size="sm" variant="outline" onClick={() => setAssignTarget(decision.id)}>
                                Atribuir
                              </Button>
                            ) : null}
                            {canProposeActionForDecision(decision.status) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={propose.isPending}
                                onClick={() => handlePropose(decision.id)}
                              >
                                Propor ação
                              </Button>
                            ) : null}
                            {!isDecisionClosed(decision.status) ? (
                              <Button size="sm" variant="destructive" onClick={() => setDismissTarget(decision.id)}>
                                Dispensar
                              </Button>
                            ) : null}
                          </div>
                        </PermissionGate>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {decisions.data ? <PaginationBar pagination={decisions.data.pagination} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      {assignTarget !== null ? (
        <AssignDecisionDialog decisionId={assignTarget} open onOpenChange={(open) => !open && setAssignTarget(null)} />
      ) : null}
      {dismissTarget !== null ? (
        <DismissDecisionDialog decisionId={dismissTarget} open onOpenChange={(open) => !open && setDismissTarget(null)} />
      ) : null}
    </div>
  );
}

function OverviewStats({
  overview,
}: {
  overview:
    | {
        openTotal: number;
        topCritical: DirectorDecision[];
        awaitingHumanAttention: DirectorDecision[];
        awaitingApproval: DirectorDecision[];
        mostRecurrent: DirectorDecision[];
      }
    | undefined;
}) {
  if (!overview) return null;

  const unassignedOpen = [...overview.topCritical, ...overview.awaitingHumanAttention].filter(
    (item, index, all) => all.findIndex((other) => other.id === item.id) === index && !item.assignedUserId,
  ).length;

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-5">
        <Stat label="Abertos" value={overview.openTotal} tone="default" />
        <Stat label="Críticos" value={overview.topCritical.length} tone="danger" />
        <Stat label="Requerem decisão humana" value={overview.awaitingHumanAttention.length} tone="warning" />
        <Stat label="Aguardando aprovação" value={overview.awaitingApproval.length} tone="warning" />
        <Stat label="Recorrentes" value={overview.mostRecurrent.length} tone="default" />
        {unassignedOpen > 0 ? <Stat label="Críticos sem responsável" value={unassignedOpen} tone="danger" /> : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "default" | "warning" | "danger" }) {
  const toneClass =
    tone === "danger"
      ? "text-red-700 dark:text-red-400"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground";

  return (
    <div>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
