"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useActionPlan } from "@/hooks/agents/use-action-plans";
import { useActionProposals, useSubmitActionProposal } from "@/hooks/agents/use-action-proposals";
import { useAuth } from "@/lib/auth/use-auth";
import { toErrorMessage } from "@/services/http";
import type { ActionPlanItemStatus, ActionProposalStatus, FollowUpStatus } from "@/types/agents";

import { ActionPlanItemStatusBadge, ActionProposalStatusBadge } from "../status-badge";
import { CancelActionProposalDialog } from "./cancel-action-proposal-dialog";
import { CreateActionProposalDialog } from "./create-action-proposal-dialog";

const FOLLOW_UP_TERMINAL_STATUSES: FollowUpStatus[] = ["completed", "dismissed"];

/**
 * Agentes v2.8 (correio.md seções 19-22) — dentro da página do FollowUp,
 * mostra as Action Proposals associadas. O usuário distingue claramente
 * FollowUp / Proposta / Action Plan: a proposta nunca é apresentada como
 * "ação executada" — só o estado real (submitted/planned/completed/
 * failed/cancelled). Quando a proposta tem `actionPlanId`, oferece um
 * link direto para a página de Action Plan já existente (reaproveitada,
 * nunca duplicada). "Propor ação" só aparece com o FollowUp não-terminal
 * (seção 22) — o backend continua soberano e rejeita de qualquer forma.
 */
export function ActionProposalsList({ followUpId, followUpStatus }: { followUpId: number; followUpStatus: FollowUpStatus }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);

  const proposals = useActionProposals(followUpId, { limit: 50 });
  const submit = useSubmitActionProposal(followUpId);

  const followUpTerminal = FOLLOW_UP_TERMINAL_STATUSES.includes(followUpStatus);

  async function handleSubmit(id: number) {
    try {
      await submit.mutateAsync(id);
      toast.success("Proposta submetida ao pipeline oficial.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao submeter."));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Ações propostas</h3>
        {!followUpTerminal ? (
          <PermissionGate permission="agents.followups.actions.manage">
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Propor ação
            </Button>
          </PermissionGate>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {proposals.isLoading ? (
          <LoadingState label="Carregando propostas..." />
        ) : proposals.isError || !proposals.data ? (
          <ErrorState onRetry={() => proposals.refetch()} />
        ) : proposals.data.data.length === 0 ? (
          <EmptyState title="Nenhuma proposta" description="Nenhuma ação foi proposta para este FollowUp ainda." />
        ) : (
          proposals.data.data.map((proposal) => (
            <div key={proposal.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{proposal.title}</p>
                  <p className="text-xs text-muted-foreground">{proposal.objective}</p>
                </div>
                <ActionProposalStatusBadge status={proposal.status} />
              </div>

              {proposal.failureReason ? <p className="mt-2 text-xs text-red-700 dark:text-red-400">{proposal.failureReason}</p> : null}

              {proposal.actionPlanId ? <ActionPlanEvidence actionPlanId={proposal.actionPlanId} proposalStatus={proposal.status} /> : null}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {proposal.actionPlanId ? (
                  <Link href={`/agents/plans/${proposal.actionPlanId}`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                    Ver Action Plan #{proposal.actionPlanId}
                  </Link>
                ) : null}

                <PermissionGate permission="agents.followups.actions.manage">
                  <div className="ml-auto flex items-center gap-2">
                    {proposal.status === "submitted" ? (
                      <Button size="sm" variant="outline" disabled={submit.isPending} onClick={() => handleSubmit(proposal.id)}>
                        Submeter
                      </Button>
                    ) : null}
                    {/* Fechamento v2.8: cancelamento só é possível em
                    "submitted" — uma proposta já planejada é governada
                    pelo Action Plan/Approval correspondente, nunca mais
                    por um cancelamento da proposta em si. */}
                    {proposal.status === "submitted" ? (
                      <Button size="sm" variant="destructive" onClick={() => setCancelTarget(proposal.id)}>
                        Cancelar
                      </Button>
                    ) : null}
                  </div>
                </PermissionGate>
              </div>
            </div>
          ))
        )}
      </CardContent>

      <CreateActionProposalDialog followUpId={followUpId} open={createOpen} onOpenChange={setCreateOpen} />
      {cancelTarget !== null ? (
        <CancelActionProposalDialog followUpId={followUpId} proposalId={cancelTarget} open onOpenChange={(open) => !open && setCancelTarget(null)} />
      ) : null}
    </Card>
  );
}

const EVIDENCE_BUCKETS: { label: string; statuses: ActionPlanItemStatus[] }[] = [
  { label: "Executaram", statuses: ["completed"] },
  { label: "Bloqueadas", statuses: ["blocked"] },
  { label: "Exigiram aprovação", statuses: ["waiting_approval", "approved", "rejected"] },
  { label: "Falharam", statuses: ["failed", "rejected"] },
];

/**
 * Agentes v2.9 (correio.md "BLOQUEIO 2") — evidência real do Action Plan
 * direto na página do FollowUp: quantos itens executaram, foram
 * bloqueados, exigiram Approval, ou falharam. Vem 100% de
 * `GET /agents/action-plans/:id` (já existente, mesma estrutura que a
 * página de Action Plan usa) — nenhum resultado novo é duplicado em JSON
 * próprio. Só busca quando o usuário tem `agents.plan.read` — sem essa
 * permission, some silenciosamente (mesmo padrão de `PermissionGate`),
 * nunca gera um ErrorState ruidoso por uma permission que boa parte dos
 * operadores de FollowUp não precisa ter.
 *
 * Regra fundamental (correio.md): esta evidência é só leitura/contexto —
 * nunca conclui o FollowUp sozinha. "Ação executada" aqui é sempre
 * seguida por uma nota de que a conclusão do FollowUp continua sendo uma
 * decisão humana (ver `FollowUpDetail`/`ActionProposalsList` acima, que
 * nunca chama `useCompleteFollowUp` automaticamente a partir disto).
 */
function ActionPlanEvidence({ actionPlanId, proposalStatus }: { actionPlanId: number; proposalStatus: ActionProposalStatus }) {
  const { can } = useAuth();
  const canRead = can("agents.plan.read");
  const plan = useActionPlan(canRead ? actionPlanId : null);

  if (!canRead || plan.isLoading || plan.isError || !plan.data) return null;

  const items = plan.data.data.items;
  const total = items.length;

  return (
    <div className="mt-2 rounded-md bg-muted/50 p-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {EVIDENCE_BUCKETS.map(({ label, statuses }) => {
          const count = items.filter((item) => statuses.includes(item.executionStatus)).length;
          if (count === 0) return null;
          return (
            <span key={label}>
              {label}: <span className="font-medium text-foreground">{count}</span>/{total}
            </span>
          );
        })}
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((item) => (
          <ActionPlanItemStatusBadge key={item.id} status={item.executionStatus} />
        ))}
      </div>

      {/* Regra fundamental do BLOQUEIO 2 — "Action Plan completed" NÃO
      significa "FollowUp completed": deixa isso explícito para o
      operador, nunca sugere que a conclusão já aconteceu sozinha. */}
      {proposalStatus === "completed" ? (
        <p className="mt-2 text-xs text-blue-700 dark:text-blue-400">Ação executada — aguardando resolução do acompanhamento.</p>
      ) : proposalStatus === "failed" ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
          Ação não foi concluída com sucesso — decida se propõe outra ação, ajusta o acompanhamento, ou resolve com justificativa.
        </p>
      ) : null}
    </div>
  );
}
