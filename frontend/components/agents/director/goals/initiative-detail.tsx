"use client";

import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import {
  useApproveInitiative,
  useCompleteInitiative,
  useDirectorInitiative,
  useGenerateInitiativeReview,
  useInitiativeExecution,
  useInitiativeReview,
  useProposeInitiativeAction,
} from "@/hooks/agents/use-director-goals";
import { approvalState, canProposeActionForInitiative, goalPriorityLabel, reviewOutcomeLabel, signalDomainLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";
import type { ExecutiveReview, InitiativeExecutionState, InitiativeExecutionView } from "@/types/agents";

import { ApprovalStateBadge, InitiativeExecutionStateBadge, InitiativeStatusBadge, RecommendationTypeBadge, ReviewOutcomeBadge } from "../../status-badge";

/**
 * Agentes v2.0 (correio.md seção 16/21) — nunca executa nada
 * diretamente: "Propor ação" chama o pipeline oficial (mesmo componente
 * já usado pelo Decision Item na v1.9) e o resultado mostra a decisão
 * real do Policy Evaluator, nunca uma confirmação inventada na UI.
 */
export function InitiativeDetail({ initiativeId }: { initiativeId: number }) {
  const { data, isLoading, isError, refetch } = useDirectorInitiative(initiativeId);
  const executionQuery = useInitiativeExecution(initiativeId);
  const reviewQuery = useInitiativeReview(initiativeId);
  const usersQuery = useUsersDirectory();
  const approve = useApproveInitiative();
  const complete = useCompleteInitiative();
  const propose = useProposeInitiativeAction();
  const generateReview = useGenerateInitiativeReview();

  if (isLoading) return <LoadingState label="Carregando Initiative..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { initiative, pendingApproval } = data.data;
  const userName = (userId: number | null) =>
    userId ? (usersQuery.data?.data.find((user) => user.id === userId)?.name ?? `Usuário #${userId}`) : "--";

  async function handleApprove() {
    try {
      await approve.mutateAsync(initiativeId);
      toast.success("Initiative aprovada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao aprovar."));
    }
  }

  async function handleComplete() {
    try {
      await complete.mutateAsync(initiativeId);
      toast.success("Initiative concluída.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao concluir."));
    }
  }

  async function handlePropose() {
    try {
      const { data: result } = await propose.mutateAsync(initiativeId);
      toast.success(result.created ? `Plano #${result.plan.id} criado a partir da iniciativa.` : `Execução já em andamento — plano #${result.plan.id}.`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao propor ação."));
    }
  }

  async function handleGenerateReview() {
    try {
      await generateReview.mutateAsync(initiativeId);
      toast.success("Executive Review gerada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao gerar Executive Review."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <InitiativeStatusBadge status={initiative.status} />
            <Badge variant="secondary" className="border-transparent">
              {goalPriorityLabel(initiative.priority)}
            </Badge>
            {initiative.origin === "director_recommendation" ? (
              <Badge variant="secondary" className="border-transparent bg-violet-500/10 text-violet-700 dark:text-violet-400">
                Recomendação do Diretor
              </Badge>
            ) : null}
          </div>
          <PermissionGate permission="agents.director.initiatives.manage">
            <div className="flex gap-2">
              {initiative.status === "proposed" ? (
                <Button size="sm" variant="outline" disabled={approve.isPending} onClick={handleApprove}>
                  Aprovar
                </Button>
              ) : null}
              {canProposeActionForInitiative(initiative.status) ? (
                <Button size="sm" disabled={propose.isPending} onClick={handlePropose}>
                  Propor ação
                </Button>
              ) : null}
              {initiative.status === "active" ? (
                <Button size="sm" variant="outline" disabled={complete.isPending} onClick={handleComplete}>
                  Concluir
                </Button>
              ) : null}
            </div>
          </PermissionGate>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <Link href={`/agents/director/goals/${initiative.goalId}`} className="text-xs text-primary underline underline-offset-2">
              Ver Goal #{initiative.goalId}
            </Link>
          </div>
          <p className="text-sm font-medium">{initiative.title}</p>
          <p className="text-sm text-muted-foreground">{initiative.description}</p>
          <p className="text-sm">
            <span className="text-muted-foreground">Racional: </span>
            {initiative.rationale}
          </p>
          {initiative.expectedImpact ? (
            <p className="text-sm">
              <span className="text-muted-foreground">Impacto esperado: </span>
              {initiative.expectedImpact}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {executionQuery.data ? <ExecutionCard view={executionQuery.data.data.execution} /> : null}

      {executionQuery.data && REVIEWABLE_EXECUTION_STATES.has(executionQuery.data.data.execution.state) ? (
        <ExecutiveReviewCard
          review={reviewQuery.data?.data ?? null}
          isPending={generateReview.isPending}
          onGenerate={handleGenerateReview}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Informações</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Domínio" value={signalDomainLabel(initiative.domain)} />
            <Row label="Responsável" value={userName(initiative.ownerUserId)} />
            <Row label="Criada por" value={userName(initiative.createdBy)} />
            <Row label="Criada em" value={formatDateTime(initiative.createdAt)} />
            <Row label="Iniciada em" value={formatDateTime(initiative.startedAt)} />
            <Row label="Concluída em" value={formatDateTime(initiative.completedAt)} />
            {initiative.status === "cancelled" ? <Row label="Motivo do cancelamento" value={initiative.cancellationReason ?? "--"} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">Action Plan</h3>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {initiative.actionPlanId ? (
              <Link href={`/agents/plans/${initiative.actionPlanId}`} className="text-primary underline underline-offset-2">
                Ver plano #{initiative.actionPlanId}
              </Link>
            ) : (
              <p className="text-muted-foreground">Nenhum Action Plan proposto ainda.</p>
            )}
            {pendingApproval ? (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-muted-foreground">Approval:</span>
                <ApprovalStateBadge state={approvalState(pendingApproval)} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

const EXECUTION_BAR_COLORS: Record<InitiativeExecutionState, string> = {
  not_started: "bg-muted-foreground/40",
  waiting_approval: "bg-amber-500",
  running: "bg-blue-500",
  blocked: "bg-amber-500",
  failed: "bg-red-500",
  completed: "bg-emerald-500",
};

/**
 * Agentes v2.1 (correio.md seção 14) — visão operacional da execução:
 * progresso real (não texto do LLM), itens concluídos/total, approvals
 * pendentes, bloqueios. Reaproveita o mesmo padrão visual da barra de
 * progresso de Goal (`GoalProgressBar`) — cores diferentes porque o
 * domínio é outro (execução, não saúde de Goal), mesma linguagem visual.
 */
function ExecutionCard({ view }: { view: InitiativeExecutionView }) {
  if (view.state === "not_started") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Execução</h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Ainda não iniciada — nenhum Action Plan gerado.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Execução</h3>
        <InitiativeExecutionStateBadge state={view.state} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${EXECUTION_BAR_COLORS[view.state]}`}
            style={{ width: `${Math.max(0, Math.min(100, view.progressPercent))}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {view.completedItems} / {view.totalItems} ações concluídas
          </span>
          <span className="text-muted-foreground">{view.progressPercent}%</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {view.pendingApprovalItems > 0 ? <span>{view.pendingApprovalItems} aguardando aprovação</span> : null}
          {view.blockedItems > 0 ? <span>{view.blockedItems} bloqueada(s)</span> : null}
          {view.failedItems > 0 ? <span>{view.failedItems} com falha</span> : null}
          {view.shadowedItems > 0 ? <span>{view.shadowedItems} não executada(s) (shadow)</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

// Agentes v2.2 (correio.md seção 13) — só estados TERMINAIS da execução
// real são elegíveis para gerar/mostrar a Executive Review — mesmo
// conjunto usado pelo backend (`REVIEWABLE_EXECUTION_STATES`,
// reviews/types.ts), nunca "running"/"waiting_approval"/"not_started".
const REVIEWABLE_EXECUTION_STATES = new Set<InitiativeExecutionState>(["completed", "blocked", "failed"]);

/**
 * Agentes v2.2 (correio.md seções 19-22) — nunca sugere que a
 * recomendação é decisão automática: "Gerar Executive Review" é uma ação
 * explícita do usuário (pipeline oficial por trás, `POST .../review`),
 * e cada recomendação é mostrada como TEXTO interpretativo do Diretor —
 * "new_initiative" nunca tem botão de "executar imediatamente" (o link
 * leva para a tela da nova Initiative, que ainda precisa passar por todo
 * o ciclo de aprovação oficial); "escalate" mostra claramente que a
 * decisão é do CEO, nunca do sistema.
 */
function ExecutiveReviewCard({
  review,
  isPending,
  onGenerate,
}: {
  review: ExecutiveReview | null;
  isPending: boolean;
  onGenerate: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">Executive Review</h3>
        <div className="flex items-center gap-2">
          {review ? <ReviewOutcomeBadge outcome={review.outcome!} /> : null}
          <PermissionGate permission="agents.director.initiatives.manage">
            <Button size="sm" variant="outline" disabled={isPending} onClick={onGenerate}>
              {review ? "Atualizar Executive Review" : "Gerar Executive Review"}
            </Button>
          </PermissionGate>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!review ? (
          <p className="text-muted-foreground">Nenhuma Executive Review gerada ainda para esta execução.</p>
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground">Resultado estratégico</p>
              <p className="font-medium">{review.outcome ? reviewOutcomeLabel(review.outcome) : "--"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Resumo executivo</p>
              <p>{review.summary}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Avaliação</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{review.assessment}</p>
            </div>
            {review.evidence && "execution" in review.evidence ? (
              <div>
                <p className="text-xs text-muted-foreground">Evidências</p>
                <p className="text-muted-foreground">
                  {(review.evidence as { execution: { completedItems: number; totalItems: number; shadowedItems: number } }).execution.completedItems}/
                  {(review.evidence as { execution: { completedItems: number; totalItems: number } }).execution.totalItems} ações concluídas
                  {(review.evidence as { execution: { shadowedItems: number } }).execution.shadowedItems > 0
                    ? `, ${(review.evidence as { execution: { shadowedItems: number } }).execution.shadowedItems} não executada(s) (shadow)`
                    : ""}
                </p>
              </div>
            ) : null}
            {review.confidence ? (
              <div>
                <p className="text-xs text-muted-foreground">Confiança da avaliação</p>
                <p>{Math.round(Number(review.confidence) * 100)}%</p>
              </div>
            ) : null}
            {review.recommendation ? (
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Recomendação do Diretor</p>
                  <RecommendationTypeBadge type={review.recommendationType!} />
                </div>
                <p>{review.recommendation.reason}</p>

                {review.recommendationType === "new_initiative" && review.resultingInitiativeId ? (
                  <div className="rounded-md bg-violet-500/10 p-2 text-xs">
                    <p className="font-medium text-violet-700 dark:text-violet-400">Diretor recomenda uma nova iniciativa</p>
                    {review.recommendation.proposedGoal ? <p className="mt-1">{review.recommendation.proposedGoal}</p> : null}
                    <Link
                      href={`/agents/director/initiatives/${review.resultingInitiativeId}`}
                      className="mt-1 inline-block text-primary underline underline-offset-2"
                    >
                      Ver proposta #{review.resultingInitiativeId} (aguardando aprovação)
                    </Link>
                  </div>
                ) : null}

                {review.recommendationType === "escalate" ? (
                  <div className="rounded-md bg-amber-500/10 p-2 text-xs">
                    <p className="font-medium text-amber-700 dark:text-amber-400">Decisão do CEO necessária</p>
                    {review.resultingDecisionId ? (
                      <Link
                        href={`/agents/director/decisions/${review.resultingDecisionId}`}
                        className="mt-1 inline-block text-primary underline underline-offset-2"
                      >
                        Ver item na Decision Queue #{review.resultingDecisionId}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
