"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAgents } from "@/hooks/agents/use-agents";
import { useFollowUps, useResumeFollowUp, useStartFollowUp } from "@/hooks/agents/use-follow-ups";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { followUpPriorityLabel, followUpSourceTypeLabel, formatAgeSeconds } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import { FOLLOW_UP_PRIORITIES, FOLLOW_UP_STATUSES, type FollowUpPriority, type FollowUpStatus } from "@/types/agents";

import { FollowUpStatusBadge } from "../status-badge";
import { CompleteFollowUpDialog } from "./complete-follow-up-dialog";
import { CreateFollowUpDialog } from "./create-follow-up-dialog";
import { DismissFollowUpDialog } from "./dismiss-follow-up-dialog";
import { WaitFollowUpDialog } from "./wait-follow-up-dialog";

const LIMIT = 20;

/**
 * Agentes v2.7 (correio.md seções 18-20) — dashboard operacional de
 * FollowUps: resumo de atenção (seção 19, 100% derivado dos dados desta
 * página — nenhum sistema de analytics novo), listagem filtrável, e
 * ações que só aparecem quando válidas para o estado atual (seção 20) —
 * o backend sempre revalida de qualquer forma.
 */
export function FollowUpsList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<FollowUpStatus | "all">("all");
  const [priority, setPriority] = useState<FollowUpPriority | "all">("all");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [waitTarget, setWaitTarget] = useState<number | null>(null);
  const [completeTarget, setCompleteTarget] = useState<number | null>(null);
  const [dismissTarget, setDismissTarget] = useState<number | null>(null);

  const agentsQuery = useAgents();
  const usersQuery = useUsersDirectory();
  const followUps = useFollowUps({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
    priority: priority === "all" ? undefined : priority,
    overdue: onlyOverdue || undefined,
  });
  const start = useStartFollowUp();
  const resume = useResumeFollowUp();

  // Resumo de atenção (seção 19) — só a página atual carregada não
  // representa o total real; por isso um segundo fetch, sem filtros de
  // status, limitado ao necessário para os contadores. Evita criar um
  // endpoint de agregação novo (seção 19: "sem criar novo sistema de
  // analytics") calculando no cliente sobre uma janela ampla o
  // suficiente para ser representativa.
  const attentionQuery = useFollowUps({ page: 1, limit: 100 });
  const attention = useMemo(() => {
    const rows = attentionQuery.data?.data ?? [];
    const now = Date.now();
    return {
      open: rows.filter((row) => row.status === "open").length,
      inProgress: rows.filter((row) => row.status === "in_progress").length,
      waiting: rows.filter((row) => row.status === "waiting").length,
      overdue: rows.filter((row) => row.dueAt && new Date(row.dueAt).getTime() < now && row.status !== "completed" && row.status !== "dismissed").length,
      critical: rows.filter((row) => row.priority === "critical" && row.status !== "completed" && row.status !== "dismissed").length,
    };
  }, [attentionQuery.data]);

  const agentName = (agentId: number) => agentsQuery.data?.data.find((agent) => agent.id === agentId)?.name ?? `Agente #${agentId}`;
  const userName = (userId: number | null) => (userId ? (usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`) : "--");

  async function handleStart(id: number) {
    try {
      await start.mutateAsync(id);
      toast.success("FollowUp iniciado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao iniciar."));
    }
  }

  async function handleResume(id: number) {
    try {
      await resume.mutateAsync(id);
      toast.success("FollowUp retomado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao retomar."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-5">
          <Stat label="Abertos" value={attention.open} tone="default" />
          <Stat label="Em andamento" value={attention.inProgress} tone="default" />
          <Stat label="Aguardando" value={attention.waiting} tone="warning" />
          <Stat label="Vencidos" value={attention.overdue} tone="danger" />
          <Stat label="Críticos" value={attention.critical} tone="danger" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Follow-ups</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(value) => {
                setPage(1);
                setStatus((value as FollowUpStatus | "all") ?? "all");
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {FOLLOW_UP_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={priority}
              onValueChange={(value) => {
                setPage(1);
                setPriority((value as FollowUpPriority | "all") ?? "all");
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda prioridade</SelectItem>
                {FOLLOW_UP_PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {followUpPriorityLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant={onlyOverdue ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setPage(1);
                setOnlyOverdue((value) => !value);
              }}
            >
              Vencidos
            </Button>

            <PermissionGate permission="agents.followups.manage">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                Novo FollowUp
              </Button>
            </PermissionGate>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {followUps.isLoading ? (
            <LoadingState label="Carregando follow-ups..." />
          ) : followUps.isError || !followUps.data ? (
            <ErrorState onRetry={() => followUps.refetch()} />
          ) : followUps.data.data.length === 0 ? (
            <EmptyState title="Nenhum FollowUp" description="Nenhum corresponde aos filtros selecionados." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Atribuído</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Idade</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {followUps.data.data.map((followUp) => {
                    const overdue = followUp.dueAt && new Date(followUp.dueAt).getTime() < Date.now() && followUp.status !== "completed" && followUp.status !== "dismissed";
                    const ageSeconds = Math.floor((Date.now() - new Date(followUp.createdAt).getTime()) / 1000);

                    return (
                      <TableRow key={followUp.id}>
                        <TableCell className="max-w-64 text-sm font-medium">{followUp.title}</TableCell>
                        <TableCell className="text-xs">{agentName(followUp.ownerAgentId)}</TableCell>
                        <TableCell className="text-xs">{userName(followUp.assignedUserId)}</TableCell>
                        <TableCell className="text-xs">{followUpPriorityLabel(followUp.priority)}</TableCell>
                        <TableCell>
                          <FollowUpStatusBadge status={followUp.status} />
                        </TableCell>
                        <TableCell className="text-xs">{followUpSourceTypeLabel(followUp.sourceType)}</TableCell>
                        <TableCell className="text-xs">
                          {followUp.dueAt ? (
                            <span className={overdue ? "font-medium text-red-700 dark:text-red-400" : ""}>
                              {new Date(followUp.dueAt).toLocaleDateString("pt-BR")}
                            </span>
                          ) : (
                            "--"
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatAgeSeconds(ageSeconds)}</TableCell>
                        <TableCell className="text-right">
                          <PermissionGate permission="agents.followups.manage">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {followUp.status === "open" ? (
                                <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => handleStart(followUp.id)}>
                                  Iniciar
                                </Button>
                              ) : null}
                              {followUp.status === "waiting" ? (
                                <Button size="sm" variant="outline" disabled={resume.isPending} onClick={() => handleResume(followUp.id)}>
                                  Retomar
                                </Button>
                              ) : null}
                              {followUp.status === "open" || followUp.status === "in_progress" ? (
                                <Button size="sm" variant="outline" onClick={() => setWaitTarget(followUp.id)}>
                                  Aguardar
                                </Button>
                              ) : null}
                              {followUp.status !== "completed" && followUp.status !== "dismissed" ? (
                                <Button size="sm" variant="outline" onClick={() => setCompleteTarget(followUp.id)}>
                                  Concluir
                                </Button>
                              ) : null}
                              {followUp.status !== "completed" && followUp.status !== "dismissed" ? (
                                <Button size="sm" variant="destructive" onClick={() => setDismissTarget(followUp.id)}>
                                  Descartar
                                </Button>
                              ) : null}
                            </div>
                          </PermissionGate>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {followUps.data ? <PaginationBar pagination={followUps.data.pagination} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      <CreateFollowUpDialog open={createOpen} onOpenChange={setCreateOpen} />
      {waitTarget !== null ? <WaitFollowUpDialog followUpId={waitTarget} open onOpenChange={(open) => !open && setWaitTarget(null)} /> : null}
      {completeTarget !== null ? <CompleteFollowUpDialog followUpId={completeTarget} open onOpenChange={(open) => !open && setCompleteTarget(null)} /> : null}
      {dismissTarget !== null ? <DismissFollowUpDialog followUpId={dismissTarget} open onOpenChange={(open) => !open && setDismissTarget(null)} /> : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "default" | "warning" | "danger" }) {
  const toneClass =
    tone === "danger" ? "text-red-700 dark:text-red-400" : tone === "warning" ? "text-amber-700 dark:text-amber-400" : "text-foreground";

  return (
    <div>
      <p className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
