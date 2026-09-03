"use client";

import { useState } from "react";
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
import { useAcknowledgeEscalation, useEscalations, useResolveEscalation } from "@/hooks/agents/use-escalations";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { toErrorMessage } from "@/services/http";
import { ESCALATION_SEVERITIES, ESCALATION_STATUSES, type EscalationSeverity, type EscalationStatus } from "@/types/agents";

import { EscalationSeverityBadge, EscalationStatusBadge } from "../status-badge";
import { DismissEscalationDialog } from "./dismiss-escalation-dialog";

const LIMIT = 20;

/**
 * Agentes v2.6 (correio.md seção 22) — listagem de Operational
 * Escalations com ações de ciclo de vida (acknowledge/resolve/dismiss),
 * espelhando DecisionQueue (v1.9). Nenhum formulário de criação — não
 * existe endpoint de criação livre (seção 19).
 */
export function EscalationsList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<EscalationStatus | "all">("open");
  const [severity, setSeverity] = useState<EscalationSeverity | "all">("all");
  const [dismissTarget, setDismissTarget] = useState<number | null>(null);

  const agentsQuery = useAgents();
  const usersQuery = useUsersDirectory();
  const escalations = useEscalations({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
    severity: severity === "all" ? undefined : severity,
  });
  const acknowledge = useAcknowledgeEscalation();
  const resolve = useResolveEscalation();

  const agentName = (agentId: number | null) => (agentId ? (agentsQuery.data?.data.find((agent) => agent.id === agentId)?.name ?? `Agente #${agentId}`) : "--");
  const userName = (userId: number | null) => (userId ? (usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`) : "--");

  async function handleAcknowledge(id: number) {
    try {
      await acknowledge.mutateAsync(id);
      toast.success("Escalation reconhecida.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao reconhecer."));
    }
  }

  async function handleResolve(id: number) {
    try {
      await resolve.mutateAsync(id);
      toast.success("Escalation resolvida.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao resolver."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Escalations</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(value) => {
                setPage(1);
                setStatus(value as EscalationStatus | "all");
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {ESCALATION_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={severity}
              onValueChange={(value) => {
                setPage(1);
                setSeverity(value as EscalationSeverity | "all");
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda severidade</SelectItem>
                {ESCALATION_SEVERITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {escalations.isLoading ? (
            <LoadingState label="Carregando escalations..." />
          ) : escalations.isError || !escalations.data ? (
            <ErrorState onRetry={() => escalations.refetch()} />
          ) : escalations.data.data.length === 0 ? (
            <EmptyState title="Nenhuma escalation" description="Nenhuma corresponde aos filtros selecionados." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severidade</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Alvo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {escalations.data.data.map((escalation) => (
                    <TableRow key={escalation.id}>
                      <TableCell>
                        <EscalationSeverityBadge severity={escalation.severity} />
                      </TableCell>
                      <TableCell className="max-w-80 text-sm">{escalation.reason}</TableCell>
                      <TableCell className="text-xs">{agentName(escalation.sourceAgentId)}</TableCell>
                      <TableCell className="text-xs">
                        {escalation.targetAgentId ? `Agente: ${agentName(escalation.targetAgentId)}` : null}
                        {escalation.targetUserId ? `Usuário: ${userName(escalation.targetUserId)}` : null}
                        {!escalation.targetAgentId && !escalation.targetUserId ? "--" : null}
                      </TableCell>
                      <TableCell>
                        <EscalationStatusBadge status={escalation.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PermissionGate permission="agents.escalations.manage">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {escalation.status === "open" ? (
                              <Button size="sm" variant="outline" disabled={acknowledge.isPending} onClick={() => handleAcknowledge(escalation.id)}>
                                Reconhecer
                              </Button>
                            ) : null}
                            {escalation.status === "open" || escalation.status === "acknowledged" ? (
                              <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => handleResolve(escalation.id)}>
                                Resolver
                              </Button>
                            ) : null}
                            {escalation.status === "open" || escalation.status === "acknowledged" ? (
                              <Button size="sm" variant="destructive" onClick={() => setDismissTarget(escalation.id)}>
                                Descartar
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

          {escalations.data ? <PaginationBar pagination={escalations.data.pagination} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      {dismissTarget !== null ? (
        <DismissEscalationDialog escalationId={dismissTarget} open onOpenChange={(open) => !open && setDismissTarget(null)} />
      ) : null}
    </div>
  );
}
