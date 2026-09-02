"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAuditLogs } from "@/hooks/agents/use-operations";
import { formatDateTime } from "@/lib/agents/format";

const LIMIT = 20;

// Agentes v1.6 (correio.md seção 9) — tela de auditoria. `audit_logs` é
// usado pelo projeto inteiro, não só por agentes — os filtros por
// action/entityType/entityId aqui cobrem tanto ações de agentes
// (agent_autonomy.*, agent_job.*, agent_event_rule.*, ...) quanto o
// restante do sistema, sem restringir a busca.
export function AuditLogList() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");

  const { data, isLoading, isError, refetch } = useAuditLogs({
    page,
    limit: LIMIT,
    action: action.trim() || undefined,
    entityType: entityType.trim() || undefined,
    entityId: entityId.trim() || undefined,
  });

  function resetToFirstPage() {
    setPage(1);
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          placeholder="Filtrar por action (ex.: agent_autonomy.blocked)"
          value={action}
          onChange={(event) => {
            resetToFirstPage();
            setAction(event.target.value);
          }}
          className="sm:max-w-64"
        />
        <Input
          placeholder="entityType"
          value={entityType}
          onChange={(event) => {
            resetToFirstPage();
            setEntityType(event.target.value);
          }}
          className="sm:max-w-40"
        />
        <Input
          placeholder="entityId"
          value={entityId}
          onChange={(event) => {
            resetToFirstPage();
            setEntityId(event.target.value);
          }}
          className="sm:max-w-32"
        />
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando trilha de auditoria..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhum registro" description="Nenhum log de auditoria encontrado com esses filtros." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Ator</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Quando</TableHead>
                  <TableHead>Metadata</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-1">
                        {log.actorType}
                      </Badge>
                      {log.actorId ?? "--"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.entityType ? `${log.entityType}#${log.entityId ?? "?"}` : "--"}
                    </TableCell>
                    <TableCell>{formatDateTime(log.createdAt)}</TableCell>
                    <TableCell className="max-w-xs">
                      {log.metadata ? (
                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-1.5 text-[11px]">
                          {JSON.stringify(log.metadata, null, 0)}
                        </pre>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
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
