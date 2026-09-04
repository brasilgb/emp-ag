"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useOperationalOwnershipWorkload } from "@/hooks/agents/use-operations";
import { useUsersDirectory } from "@/hooks/use-users-directory";

/**
 * Agentes v3.9 (correio.md "Operational Ownership Workload & Human
 * Coordination Views") — visão consolidada de ownership: quantos
 * incidentes ativos, quantos atribuídos/não atribuídos, e a distribuição
 * por responsável. Leitura pura sobre `getOperationalOwnershipWorkload`
 * (backend) — nenhum cálculo de "sobrecarga"/"capacidade" aqui, só os
 * números já agregados pelo servidor. Clicar num responsável aplica o
 * filtro `assigneeUserId` na fila Needs Attention já existente
 * (`onSelectAssignee`, controlado pelo componente pai — correio.md seção
 * 7: "não criar uma nova listagem paralela de incidentes").
 */
export function OwnershipWorkloadSection({ onSelectAssignee }: { onSelectAssignee: (userId: number) => void }) {
  const workload = useOperationalOwnershipWorkload();
  const usersQuery = useUsersDirectory();

  function assigneeName(userId: number): string {
    return usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Ownership</h3>
        <p className="text-xs text-muted-foreground">Quantidade de incidentes ativos atualmente atribuídos, por responsável — clique numa linha para ver os incidentes dessa pessoa na fila abaixo.</p>
      </CardHeader>
      <CardContent>
        {workload.isLoading ? (
          <LoadingState label="Carregando ownership..." />
        ) : workload.isError || !workload.data ? (
          <ErrorState onRetry={() => workload.refetch()} />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatBox label="Ativos" value={workload.data.data.totals.active} />
              <StatBox label="Atribuídos" value={workload.data.data.totals.assigned} />
              <StatBox label="Não atribuídos" value={workload.data.data.totals.unassigned} highlight={workload.data.data.totals.unassigned > 0} />
            </div>

            {workload.data.data.assignees.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum incidente ativo atribuído no momento.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Responsável</TableHead>
                      <TableHead>Ativos</TableHead>
                      <TableHead>Críticos</TableHead>
                      <TableHead>Atenção</TableHead>
                      <TableHead>Não revisados</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workload.data.data.assignees.map((assignee) => (
                      <TableRow key={assignee.userId} className="cursor-pointer" onClick={() => onSelectAssignee(assignee.userId)}>
                        <TableCell className="text-xs font-medium">{assigneeName(assignee.userId)}</TableCell>
                        <TableCell className="text-xs tabular-nums">{assignee.incidentCount}</TableCell>
                        <TableCell className="text-xs tabular-nums">{assignee.bySeverity.critical}</TableCell>
                        <TableCell className="text-xs tabular-nums">{assignee.bySeverity.warning}</TableCell>
                        <TableCell className="text-xs tabular-nums">{assignee.byReviewStatus.unreviewed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${highlight ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</p>
    </div>
  );
}
