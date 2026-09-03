"use client";

import { useState } from "react";
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
import { useAgents } from "@/hooks/agents/use-agents";
import { useDeleteResponsibility, useResponsibilities, useUpdateResponsibility } from "@/hooks/agents/use-responsibilities";
import { escalationPolicyLabel, responsibilityPriorityLabel, responsibilityTypeLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import type { AgentResponsibility, SignalDomain } from "@/types/agents";

import { CreateResponsibilityDialog } from "./create-responsibility-dialog";
import { EditResponsibilityDialog } from "./edit-responsibility-dialog";

const DOMAIN_OPTIONS: SignalDomain[] = ["crm", "projects", "finance", "support", "agents"];
const LIMIT = 20;

/**
 * Agentes v2.6 (correio.md seção 22) — "quem é responsável por observar
 * qual área e para quem escala": listagem filtrável + CRUD por
 * permission. Integrada à navegação existente do módulo Agentes (não uma
 * área nova desconectada).
 */
export function ResponsibilitiesList() {
  const [page, setPage] = useState(1);
  const [domain, setDomain] = useState<SignalDomain | "all">("all");
  const [enabled, setEnabled] = useState<"all" | "true" | "false">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentResponsibility | null>(null);

  const agentsQuery = useAgents();
  const responsibilities = useResponsibilities({
    page,
    limit: LIMIT,
    domain: domain === "all" ? undefined : domain,
    enabled: enabled === "all" ? undefined : enabled === "true",
  });
  const update = useUpdateResponsibility();
  const remove = useDeleteResponsibility();

  const agentName = (agentId: number) => agentsQuery.data?.data.find((agent) => agent.id === agentId)?.name ?? `Agente #${agentId}`;

  async function handleToggle(id: number, nextEnabled: boolean) {
    try {
      await update.mutateAsync({ id, input: { enabled: nextEnabled } });
      toast.success(nextEnabled ? "Responsibility habilitada." : "Responsibility desabilitada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar."));
    }
  }

  async function handleDelete(id: number) {
    try {
      await remove.mutateAsync(id);
      toast.success("Responsibility excluída.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Não foi possível excluir — desabilite em vez de excluir se houver histórico."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Responsibilities</h3>
          <div className="flex flex-wrap items-center gap-2">
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
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={enabled}
              onValueChange={(value) => {
                setPage(1);
                setEnabled(value as "all" | "true" | "false");
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="true">Habilitadas</SelectItem>
                <SelectItem value="false">Desabilitadas</SelectItem>
              </SelectContent>
            </Select>

            <PermissionGate permission="agents.responsibilities.manage">
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                Nova Responsibility
              </Button>
            </PermissionGate>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {responsibilities.isLoading ? (
            <LoadingState label="Carregando Responsibilities..." />
          ) : responsibilities.isError || !responsibilities.data ? (
            <ErrorState onRetry={() => responsibilities.refetch()} />
          ) : responsibilities.data.data.length === 0 ? (
            <EmptyState title="Nenhuma Responsibility" description="Nenhuma corresponde aos filtros selecionados." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Agente</TableHead>
                    <TableHead>Domínio</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Escalonamento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {responsibilities.data.data.map((responsibility) => (
                    <TableRow key={responsibility.id}>
                      <TableCell className="max-w-64 text-sm font-medium">{responsibility.name}</TableCell>
                      <TableCell className="text-xs">{agentName(responsibility.agentId)}</TableCell>
                      <TableCell className="text-xs">{responsibility.domain}</TableCell>
                      <TableCell className="text-xs">{responsibilityTypeLabel(responsibility.responsibilityType)}</TableCell>
                      <TableCell className="text-xs">{responsibilityPriorityLabel(responsibility.priority)}</TableCell>
                      <TableCell className="text-xs">{escalationPolicyLabel(responsibility.escalationPolicy)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            responsibility.enabled
                              ? "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "border-transparent bg-muted text-muted-foreground"
                          }
                        >
                          {responsibility.enabled ? "Habilitada" : "Desabilitada"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <PermissionGate permission="agents.responsibilities.manage">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setEditTarget(responsibility)}>
                              Editar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleToggle(responsibility.id, !responsibility.enabled)}>
                              {responsibility.enabled ? "Desabilitar" : "Habilitar"}
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleDelete(responsibility.id)}>
                              Excluir
                            </Button>
                          </div>
                        </PermissionGate>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {responsibilities.data ? <PaginationBar pagination={responsibilities.data.pagination} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      <CreateResponsibilityDialog open={createOpen} onOpenChange={setCreateOpen} />
      {editTarget ? (
        <EditResponsibilityDialog responsibility={editTarget} open onOpenChange={(open) => !open && setEditTarget(null)} />
      ) : null}
    </div>
  );
}
