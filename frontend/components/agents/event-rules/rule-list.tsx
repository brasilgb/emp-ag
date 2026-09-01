"use client";

import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useDeleteEventRule, useEventRules, useUpdateEventRule } from "@/hooks/agents/use-event-rules";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";

// Correio.md v1.4 seção 23 — lista de Event Rules cadastradas, com
// ativar/desativar e remover. Composer de criação fica em rule-composer.tsx.
export function RuleList() {
  const { data, isLoading, isError, refetch } = useEventRules({ limit: 50 });
  const update = useUpdateEventRule();
  const remove = useDeleteEventRule();

  async function handleToggle(id: number, enabled: boolean) {
    try {
      await update.mutateAsync({ id, input: { enabled: !enabled } });
      toast.success(!enabled ? "Rule ativada." : "Rule desativada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao alterar Rule."));
    }
  }

  async function handleDelete(id: number) {
    try {
      await remove.mutateAsync(id);
      toast.success("Rule removida.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao remover Rule."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <p className="text-sm font-medium">Event Rules cadastradas</p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando Event Rules..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhuma Event Rule cadastrada" description="Crie uma regra acima para disparar um Job automaticamente." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Filtros</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>{rule.name}</TableCell>
                    <TableCell className="font-mono text-xs">{rule.eventType}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">#{rule.jobId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {Object.keys(rule.filters).length === 0 ? (
                        "sem filtro"
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {Object.keys(rule.filters).map((field) => (
                            <Badge key={field} variant="outline" className="text-[10px]">
                              {field}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={rule.enabled ? "default" : "secondary"}>{rule.enabled ? "Ativada" : "Desativada"}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(rule.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <PermissionGate permission="agents.event_rules.update">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => handleToggle(rule.id, rule.enabled)}>
                            {rule.enabled ? "Desativar" : "Ativar"}
                          </Button>
                          <PermissionGate permission="agents.event_rules.delete">
                            <Button size="sm" variant="outline" disabled={remove.isPending} onClick={() => handleDelete(rule.id)}>
                              Remover
                            </Button>
                          </PermissionGate>
                        </div>
                      </PermissionGate>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
