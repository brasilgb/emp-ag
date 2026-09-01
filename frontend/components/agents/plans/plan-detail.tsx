"use client";

import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useActionPlan } from "@/hooks/agents/use-action-plans";
import { useAgentApprovals, useApproveApproval, useRejectApproval } from "@/hooks/agents/use-agent-approvals";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";

import { ActionDecisionBadge, ActionPlanItemStatusBadge, ActionPlanStatusBadge, ActionRiskBadge } from "../status-badge";

function payloadSummary(value: unknown): string {
  if (value === null || value === undefined) return "--";
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return "--";
  }
}

/**
 * Correio.md v1.2 seção 13 — detalhe de um plano: objetivo, resumo,
 * sequência de ações, risk, decision, execution status, resultado/erro.
 * Itens `approval_required` ainda pendentes ganham Aprovar/Rejeitar
 * direto aqui, reaproveitando o mesmo endpoint único de aprovações
 * (POST /agents/approvals/:id/approve|reject) usado pela fila em
 * /agents/approvals.
 */
export function PlanDetail({ planId }: { planId: number }) {
  const { data, isLoading, isError, refetch } = useActionPlan(planId);
  // A fila de aprovações pendentes é pequena por natureza (nunca mais de
  // MAX_ACTIONS_PER_PLAN=10 itens por plano); buscar as 100 mais recentes
  // pendentes e filtrar em memória evita precisar de um novo endpoint
  // "aprovações deste plano" só para esta tela.
  const { data: approvals } = useAgentApprovals({ status: "pending", limit: 100 });
  const approve = useApproveApproval();
  const reject = useRejectApproval();

  if (isLoading) return <LoadingState label="Carregando plano..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { plan, items } = data.data;

  async function handleApprove(approvalId: number) {
    try {
      await approve.mutateAsync({ id: approvalId });
      toast.success("Ação aprovada e executada.");
      refetch();
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao aprovar."));
    }
  }

  async function handleReject(approvalId: number) {
    try {
      await reject.mutateAsync({ id: approvalId });
      toast.success("Ação rejeitada.");
      refetch();
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao rejeitar."));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Objetivo</p>
            <p className="text-base">{plan.objective}</p>
            {plan.summary ? <p className="mt-1 text-sm text-muted-foreground">{plan.summary}</p> : null}
          </div>
          <ActionPlanStatusBadge status={plan.status} />
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>Criado em {formatDateTime(plan.createdAt)}</span>
          {plan.completedAt ? <span>Concluído em {formatDateTime(plan.completedAt)}</span> : null}
          {plan.llmProvider ? (
            <span>
              Provider: {plan.llmProvider} {plan.llmModel ? `(${plan.llmModel})` : ""}
            </span>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="text-sm font-medium">Ações ({items.length})</p>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhuma ação foi proposta para este objetivo.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Ferramenta</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Risco</TableHead>
                    <TableHead>Decisão</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Resultado/Erro</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const approval = approvals?.data.find((row) => row.planItemId === item.id);

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-xs text-muted-foreground">{item.sequence + 1}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {item.tool}
                          {item.dependencies && item.dependencies.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.dependencies.map((dep) => (
                                <Badge key={dep} variant="outline" className="text-[10px]">
                                  depende: {dep}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={item.reason ?? ""}>
                          {item.reason ?? "--"}
                        </TableCell>
                        <TableCell>
                          <ActionRiskBadge risk={item.risk} />
                        </TableCell>
                        <TableCell>
                          <ActionDecisionBadge decision={item.decision} />
                        </TableCell>
                        <TableCell>
                          <ActionPlanItemStatusBadge status={item.executionStatus} />
                        </TableCell>
                        <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                          {item.error ? item.error.message : payloadSummary(item.result?.data)}
                        </TableCell>
                        <TableCell className="text-right">
                          {approval ? (
                            <PermissionGate permission="agents.approve">
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
                            </PermissionGate>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Link href="/agents/plans" className="text-sm text-primary underline underline-offset-2">
        ← Voltar para todos os planos
      </Link>
    </div>
  );
}
