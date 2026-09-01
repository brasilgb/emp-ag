"use client";

import { useState } from "react";
import Link from "next/link";
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
import { useAgentApprovals, useApproveApproval, useRejectApproval } from "@/hooks/agents/use-agent-approvals";
import { approvalState } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";
import { APPROVAL_STATUSES, type ApprovalStatus } from "@/types/agents";

import { ApprovalStateBadge } from "../status-badge";

const LIMIT = 20;

function payloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "--";
  try {
    const text = JSON.stringify(payload);
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    return "--";
  }
}

// Seção 40: ação, agente, usuário solicitante, motivo, payload resumido,
// data, status. Aprovar/Rejeitar exigem agents.approve (backend é quem
// barra de verdade — PermissionGate aqui é só UX).
export function ApprovalList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ApprovalStatus | "all">("pending");

  const { data, isLoading, isError, refetch } = useAgentApprovals({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
  });

  const approve = useApproveApproval();
  const reject = useRejectApproval();

  async function handleApprove(id: number) {
    try {
      await approve.mutateAsync({ id });
      toast.success("Aprovação concedida.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao aprovar."));
    }
  }

  async function handleReject(id: number) {
    try {
      await reject.mutateAsync({ id });
      toast.success("Ação rejeitada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao rejeitar."));
    }
  }

  return (
    <Card>
      <CardHeader>
        <Select
          value={status}
          onValueChange={(value) => {
            setPage(1);
            setStatus(value as ApprovalStatus | "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {APPROVAL_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando aprovações..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="Nenhuma solicitação de aprovação"
            description="Ações sensíveis solicitadas por agentes aparecerão aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ação</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Agente</TableHead>
                  <TableHead>Solicitante</TableHead>
                  <TableHead>Payload</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((approval) => {
                  const state = approvalState(approval);
                  const pending = approval.status === "pending" && state !== "expired";

                  return (
                    <TableRow key={approval.id}>
                      <TableCell className="font-mono text-xs">{approval.toolHandler}</TableCell>
                      <TableCell className="text-xs">
                        {approval.kind === "plan_item" && approval.planId ? (
                          <Link href={`/agents/plans/${approval.planId}`} className="text-primary underline underline-offset-2">
                            Plano #{approval.planId}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Execução única</span>
                        )}
                      </TableCell>
                      <TableCell>{approval.agentName ?? approval.agentSlug ?? "--"}</TableCell>
                      <TableCell>{approval.requestedForUserName ?? "--"}</TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground">
                        {payloadSummary(approval.requestPayload)}
                      </TableCell>
                      <TableCell>{formatDateTime(approval.createdAt)}</TableCell>
                      <TableCell>
                        <ApprovalStateBadge state={state} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PermissionGate permission="agents.approve">
                          {pending ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={reject.isPending}
                                onClick={() => handleReject(approval.id)}
                              >
                                Rejeitar
                              </Button>
                              <Button size="sm" disabled={approve.isPending} onClick={() => handleApprove(approval.id)}>
                                Aprovar
                              </Button>
                            </div>
                          ) : null}
                        </PermissionGate>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {data ? <PaginationBar pagination={data.pagination} onPageChange={setPage} /> : null}
      </CardContent>
    </Card>
  );
}
