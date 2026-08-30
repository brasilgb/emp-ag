"use client";

import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useInterpreterStats, useReviewInterpretation } from "@/hooks/agents/use-interpreter-stats";
import { interpretationErrorTypeLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";
import type { HumanVerdict, InterpretationEntry, InterpretationErrorType } from "@/types/agents";

import { HumanVerdictBadge, InterpretationCategoryBadge, InterpretationErrorBadge } from "../status-badge";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function formatPercent(value: number | null): string {
  return value === null ? "--" : `${(value * 100).toFixed(1)}%`;
}

function formatMs(value: number | null): string {
  return value === null ? "--" : `${value}ms`;
}

// Seção 30-bis — só os tipos com pelo menos 1 ocorrência, para não poluir
// a tela com uma parede de zeros.
function ErrorsByTypeBreakdown({ errorsByType }: { errorsByType: Record<InterpretationErrorType, number> }) {
  const entries = Object.entries(errorsByType).filter(([, count]) => count > 0) as Array<
    [InterpretationErrorType, number]
  >;

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum erro registrado até agora.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([type, count]) => (
        <Badge key={type} variant="outline" className="gap-1.5 font-normal">
          {interpretationErrorTypeLabel(type)}
          <span className="font-semibold">{count}</span>
        </Badge>
      ))}
    </div>
  );
}

// Seção 30 — botões discretos de feedback humano. Só marcam
// human_verdict/reviewed_by/reviewed_at (o backend é quem realmente barra
// via agent.executions.manage; PermissionGate aqui é só UX) e nunca
// alteram prompt/router/model.
function ReviewButtons({ interpretation }: { interpretation: InterpretationEntry }) {
  const review = useReviewInterpretation();

  async function handleReview(verdict: HumanVerdict) {
    try {
      await review.mutateAsync({ id: interpretation.id, verdict });
      toast.success(verdict === "correct" ? "Marcado como correto." : "Marcado como incorreto.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao registrar feedback."));
    }
  }

  const pendingVerdict = review.isPending ? review.variables?.verdict : undefined;

  return (
    <div className="flex items-center justify-end gap-3">
      {interpretation.humanVerdict ? (
        <div className="flex flex-col items-end gap-0.5">
          <HumanVerdictBadge verdict={interpretation.humanVerdict} />
          {interpretation.reviewedByUserName ? (
            <span className="text-[11px] text-muted-foreground">
              por {interpretation.reviewedByUserName} · {formatDateTime(interpretation.reviewedAt)}
            </span>
          ) : null}
        </div>
      ) : null}
      <PermissionGate permission="agent.executions.manage">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-emerald-600"
            disabled={review.isPending}
            onClick={() => handleReview("correct")}
          >
            {pendingVerdict === "correct" ? "Salvando..." : "Correto"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-red-600"
            disabled={review.isPending}
            onClick={() => handleReview("incorrect")}
          >
            {pendingVerdict === "incorrect" ? "Salvando..." : "Incorreto"}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

// Seção 28: tela de observabilidade do LLM Interpreter. Nunca mostra a
// API key — o backend nunca a envia nesta resposta (seção 27).
export function InterpreterStatsView() {
  const { data: stats, isLoading, isError, refetch } = useInterpreterStats();

  if (isLoading) {
    return <LoadingState label="Carregando estatísticas..." />;
  }

  if (isError || !stats) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="text-xs text-muted-foreground">Shadow Mode</p>
            <div className="flex items-center gap-2">
              <Badge variant={stats.llmEnabled ? "default" : "secondary"}>
                {stats.llmEnabled ? "LLM ligado" : "LLM desligado"}
              </Badge>
              {stats.llmEnabled ? (
                <Badge variant={stats.shadowMode ? "secondary" : "destructive"}>
                  {stats.shadowMode ? "shadow" : "fallback"}
                </Badge>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <StatCard label="Provider" value={stats.provider} hint={stats.model} />
        <StatCard
          label="Match rate"
          value={formatPercent(stats.matchRate)}
          hint={`${stats.matches}/${stats.matches + stats.mismatches} comparáveis · ${stats.bothUnknown} sem resposta de nenhum dos dois (fora do cálculo)`}
        />
        <StatCard label="Latência média" value={formatMs(stats.averageLatencyMs)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total de interpretações" value={String(stats.total)} />
        <StatCard label="Timeouts" value={String(stats.timeouts)} />
        <StatCard label="Erros" value={String(stats.errors)} hint="Não inclui confiança baixa/pedido de esclarecimento" />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Erros por tipo</h2>
        <Card>
          <CardContent className="py-4">
            <ErrorsByTypeBreakdown errorsByType={stats.errorsByType} />
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Feedback humano</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Revisadas" value={String(stats.reviewed)} hint={`de ${stats.total} interpretações`} />
          <StatCard label="Marcadas corretas" value={String(stats.humanCorrect)} />
          <StatCard label="Marcadas incorretas" value={String(stats.humanIncorrect)} />
          <StatCard label="Acurácia (revisão humana)" value={formatPercent(stats.humanAccuracy)} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Últimas interpretações</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stats.recentInterpretations.length === 0 ? (
            <EmptyState
              title="Nenhuma interpretação comparável registrada"
              description="Quando o LLM e o roteador determinístico puderem ser comparados, os casos aparecerão aqui."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Pergunta</TableHead>
                    <TableHead>Determinístico</TableHead>
                    <TableHead>LLM</TableHead>
                    <TableHead>Confiança</TableHead>
                    <TableHead>Modo</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Erro</TableHead>
                    <TableHead className="text-right">Feedback</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentInterpretations.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell className="max-w-64 truncate">{row.userMessage ?? "--"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.deterministicTool ?? "(nenhuma)"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.llmTool ?? "(nenhuma)"}</TableCell>
                      <TableCell>{row.llmConfidence ?? "--"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.mode}</Badge>
                      </TableCell>
                      <TableCell>
                        <InterpretationCategoryBadge category={row.category} />
                      </TableCell>
                      <TableCell>
                        <InterpretationErrorBadge error={row.error} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ReviewButtons interpretation={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
