"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAgentExecutions } from "@/hooks/agents/use-agent-executions";
import { formatDateTime } from "@/lib/agents/format";
import { EXECUTION_STATUSES, type ExecutionStatus } from "@/types/agents";

import { AutonomyBadge, ExecutionStatusBadge } from "../status-badge";
import { EXECUTION_STATUS_LABELS } from "@/lib/agents/derived";

const LIMIT = 20;

function durationLabel(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return "--";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "--";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// Seção 41: data, agente, tool, usuário, nível, status, tempo, erro.
export function ExecutionList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ExecutionStatus | "all">("all");

  const { data, isLoading, isError, refetch } = useAgentExecutions({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
  });

  return (
    <Card>
      <CardHeader>
        <Select
          value={status}
          onValueChange={(value) => {
            setPage(1);
            setStatus(value as ExecutionStatus | "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {EXECUTION_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {EXECUTION_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando execuções..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhuma execução encontrada" description="Ajuste os filtros ou execute uma tool." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Agente</TableHead>
                  <TableHead>Ferramenta</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Nível</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tempo</TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((execution) => (
                  <TableRow key={execution.id}>
                    <TableCell>{formatDateTime(execution.createdAt)}</TableCell>
                    <TableCell>{execution.agentName}</TableCell>
                    <TableCell className="font-mono text-xs">{execution.toolHandler}</TableCell>
                    <TableCell>{execution.userName ?? "--"}</TableCell>
                    <TableCell>
                      <AutonomyBadge level={execution.autonomyLevel} />
                    </TableCell>
                    <TableCell>
                      <ExecutionStatusBadge status={execution.status} />
                    </TableCell>
                    <TableCell>{durationLabel(execution.startedAt, execution.finishedAt)}</TableCell>
                    <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                      {execution.error?.message ?? "--"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {data ? <PaginationBar pagination={data.pagination} onPageChange={setPage} /> : null}
      </CardContent>
    </Card>
  );
}
