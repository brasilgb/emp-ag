"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useSupervisionRun, useSupervisionRuns } from "@/hooks/agents/use-operations";
import { supervisionRunTriggerSourceLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { SUPERVISION_RUN_STATUSES, SUPERVISION_RUN_TRIGGER_SOURCES, type SupervisionRunStatus, type SupervisionRunTriggerSource } from "@/types/agents";

import { SupervisionRunStatusBadge } from "../status-badge";

const LIMIT = 20;

/**
 * Agentes v3.4 (correio.md "Operational Supervision Observability & Run
 * History") — histórico persistente das execuções do Operational
 * Supervisor (scheduler ou manual), integrado NESTA MESMA seção de
 * Supervisão Operacional (nunca uma página nova). Sem gráficos/dashboard
 * de analytics — só uma listagem filtrável + detalhe por execução
 * (correio.md "14. Frontend": "não é preciso um dashboard de
 * analytics/gráficos").
 */
export function SupervisionRunHistorySection() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SupervisionRunStatus | "all">("all");
  const [triggerSource, setTriggerSource] = useState<SupervisionRunTriggerSource | "all">("all");
  const [detailId, setDetailId] = useState<number | null>(null);

  const runs = useSupervisionRuns({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
    triggerSource: triggerSource === "all" ? undefined : triggerSource,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Histórico de execuções</h3>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={status}
              onValueChange={(value) => {
                setPage(1);
                setStatus((value as SupervisionRunStatus | "all") ?? "all");
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {SUPERVISION_RUN_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={triggerSource}
              onValueChange={(value) => {
                setPage(1);
                setTriggerSource((value as SupervisionRunTriggerSource | "all") ?? "all");
              }}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda origem</SelectItem>
                {SUPERVISION_RUN_TRIGGER_SOURCES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {supervisionRunTriggerSourceLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {runs.isLoading ? (
            <LoadingState label="Carregando histórico de supervisão..." />
          ) : runs.isError || !runs.data ? (
            <ErrorState onRetry={() => runs.refetch()} />
          ) : runs.data.data.length === 0 ? (
            <EmptyState title="Nenhuma execução" description="Nenhuma execução do Operational Supervisor corresponde aos filtros selecionados." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Início</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Achados</TableHead>
                    <TableHead>Sucessos</TableHead>
                    <TableHead>Falhas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.data.data.map((run) => (
                    <TableRow key={run.id} className="cursor-pointer" onClick={() => setDetailId(run.id)}>
                      <TableCell className="text-xs">{formatDateTime(run.startedAt)}</TableCell>
                      <TableCell className="text-xs">{supervisionRunTriggerSourceLabel(run.triggerSource)}</TableCell>
                      <TableCell>
                        <SupervisionRunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-xs">{run.durationMs !== null ? `${run.durationMs}ms` : "--"}</TableCell>
                      <TableCell className="text-xs">{run.findingsCount ?? "--"}</TableCell>
                      <TableCell className="text-xs">{run.responsesSucceeded ?? "--"}</TableCell>
                      <TableCell className="text-xs">{run.responsesFailed ?? "--"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {runs.data ? <PaginationBar pagination={runs.data.pagination} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      <SupervisionRunDetailDialog id={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
    </div>
  );
}

function SupervisionRunDetailDialog({ id, onOpenChange }: { id: number | null; onOpenChange: (open: boolean) => void }) {
  const runQuery = useSupervisionRun(id);

  return (
    <Dialog open={id !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Execução da supervisão #{id}</DialogTitle>
        </DialogHeader>

        {runQuery.isLoading ? (
          <LoadingState label="Carregando execução..." />
        ) : runQuery.isError || !runQuery.data ? (
          <ErrorState onRetry={() => runQuery.refetch()} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <DetailField label="Origem" value={supervisionRunTriggerSourceLabel(runQuery.data.data.triggerSource)} />
            <DetailField label="Status" value={<SupervisionRunStatusBadge status={runQuery.data.data.status} />} />
            <DetailField label="Início" value={formatDateTime(runQuery.data.data.startedAt)} />
            <DetailField label="Fim" value={formatDateTime(runQuery.data.data.finishedAt)} />
            <DetailField label="Duração" value={runQuery.data.data.durationMs !== null ? `${runQuery.data.data.durationMs}ms` : "--"} />
            <DetailField label="Achados" value={runQuery.data.data.findingsCount ?? "--"} />
            <DetailField label="Respostas tentadas" value={runQuery.data.data.responsesAttempted ?? "--"} />
            <DetailField label="Respostas com sucesso" value={runQuery.data.data.responsesSucceeded ?? "--"} />
            <DetailField label="Respostas com falha" value={runQuery.data.data.responsesFailed ?? "--"} />
            <DetailField label="Escalations tentadas" value={runQuery.data.data.escalationsAttempted ?? "--"} />
            <DetailField label="Escalations com sucesso" value={runQuery.data.data.escalationsSucceeded ?? "--"} />
            <DetailField label="Escalations com falha" value={runQuery.data.data.escalationsFailed ?? "--"} />
            {runQuery.data.data.errorMessage ? (
              <div className="col-span-2 space-y-1">
                <dt className="text-xs text-muted-foreground">Erro</dt>
                <dd className="text-xs text-red-700 dark:text-red-400">{runQuery.data.data.errorMessage}</dd>
              </div>
            ) : null}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
