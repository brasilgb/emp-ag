"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAttentionQueue } from "@/hooks/agents/use-operations";
import { attentionReasonLabel, incidentReviewStatusLabel, operationalIncidentTypeLabel, supervisionIncidentOutcomeLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import {
  AGING_BUCKETS,
  INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED,
  OPERATIONAL_INCIDENT_TYPES,
  OPERATIONAL_OUTCOMES,
  OPERATIONAL_SEVERITIES,
  type AgingBucket,
  type IncidentReviewStatusOrUnreviewed,
  type OperationalIncidentType,
  type OperationalSeverity,
  type SupervisionIncidentOutcome,
} from "@/types/agents";

import { AgingBucketBadge, IncidentReviewStatusBadge, OperationalIncidentTypeBadge, OperationalSeverityBadge, SupervisionIncidentOutcomeBadge } from "../status-badge";
import { SupervisionIncidentDetailDialog } from "./supervision-insights-section";

const LIMIT = 20;

/**
 * Agentes v3.7 (correio.md "Operational Incident Review Queue & Attention
 * Management") — fila operacional "Needs Attention". Projeção pura sobre
 * `SupervisionIncidentSummary` (v3.5) + review (v3.6): nenhum conceito
 * novo de incidente, nenhuma segunda implementação de review — o clique
 * numa linha abre o MESMO diálogo de detalhe/review já usado pela seção
 * "Insights de Supervisão" (`SupervisionIncidentDetailDialog`, exportado
 * de supervision-insights-section.tsx). A ORDEM das linhas já É a
 * priorização (correio.md "Prioridade operacional": determinística,
 * explicável, reproduzível) — `attentionReasons` explica por que cada
 * item está acima do próximo.
 */
export function AttentionQueueSection() {
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState<OperationalSeverity | "all">("all");
  const [incidentType, setIncidentType] = useState<OperationalIncidentType | "all">("all");
  const [outcome, setOutcome] = useState<SupervisionIncidentOutcome | "all">("all");
  const [reviewStatus, setReviewStatus] = useState<IncidentReviewStatusOrUnreviewed | "all">("all");
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [agingBucket, setAgingBucket] = useState<AgingBucket | "all">("all");
  const [detailId, setDetailId] = useState<number | null>(null);

  const queue = useAttentionQueue({
    page,
    limit: LIMIT,
    severity: severity === "all" ? undefined : severity,
    incidentType: incidentType === "all" ? undefined : incidentType,
    outcome: outcome === "all" ? undefined : outcome,
    // Ausente = default da fila (exclui resolved/dismissed, ver
    // listAttentionQueue no backend). "all" aqui é o default do FILTRO
    // de UI, não um valor real enviado ao backend.
    reviewStatus: reviewStatus === "all" ? undefined : reviewStatus,
    recurringOnly: recurringOnly || undefined,
    agingBucket: agingBucket === "all" ? undefined : agingBucket,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">Needs Attention</h3>
          <p className="text-xs text-muted-foreground">Incidentes não revisados, reconhecidos pendentes, recorrentes, antigos ou de maior severidade — ordenados por prioridade.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={severity}
            onValueChange={(value) => {
              setPage(1);
              setSeverity((value as OperationalSeverity | "all") ?? "all");
            }}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda severidade</SelectItem>
              {OPERATIONAL_SEVERITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={incidentType}
            onValueChange={(value) => {
              setPage(1);
              setIncidentType((value as OperationalIncidentType | "all") ?? "all");
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo tipo</SelectItem>
              {OPERATIONAL_INCIDENT_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {operationalIncidentTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={outcome}
            onValueChange={(value) => {
              setPage(1);
              setOutcome((value as SupervisionIncidentOutcome | "all") ?? "all");
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo resultado</SelectItem>
              {OPERATIONAL_OUTCOMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {supervisionIncidentOutcomeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={reviewStatus}
            onValueChange={(value) => {
              setPage(1);
              setReviewStatus((value as IncidentReviewStatusOrUnreviewed | "all") ?? "all");
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* "all" aqui não é literal — cai no default da fila
                  (exclui resolved/dismissed). Para ver TODOS os status
                  (inclusive resolved/dismissed), o operador usa o
                  histórico completo na seção "Insights de Supervisão". */}
              <SelectItem value="all">Review (padrão da fila)</SelectItem>
              {INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED.map((value) => (
                <SelectItem key={value} value={value}>
                  {incidentReviewStatusLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={agingBucket}
            onValueChange={(value) => {
              setPage(1);
              setAgingBucket((value as AgingBucket | "all") ?? "all");
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toda idade</SelectItem>
              {AGING_BUCKETS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={recurringOnly ? "true" : "false"}
            onValueChange={(value) => {
              setPage(1);
              setRecurringOnly(value === "true");
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">Todos</SelectItem>
              <SelectItem value="true">Só recorrentes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {queue.isLoading ? (
          <LoadingState label="Carregando fila..." />
        ) : queue.isError || !queue.data ? (
          <ErrorState onRetry={() => queue.refetch()} />
        ) : queue.data.data.length === 0 ? (
          <EmptyState title="Nada precisa de atenção" description="Nenhum incidente corresponde aos filtros selecionados — a fila está em dia." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>Severidade</TableHead>
                  <TableHead>Idade</TableHead>
                  <TableHead>Recorrência</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Por que aparece aqui</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.data.data.map((item) => (
                  <TableRow key={item.auditLogId} className="cursor-pointer" onClick={() => setDetailId(item.auditLogId)}>
                    <TableCell>
                      <OperationalIncidentTypeBadge type={item.incidentType} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.entityType} #{item.entityId}
                      <div className="text-muted-foreground">detectado em {formatDateTime(item.detectedAt)}</div>
                    </TableCell>
                    <TableCell>
                      <OperationalSeverityBadge severity={item.severity} />
                    </TableCell>
                    <TableCell>
                      <AgingBucketBadge bucket={item.agingBucket} />
                      {item.sinceReviewBucket ? <div className="mt-1 text-[11px] text-muted-foreground">reconhecido há {item.sinceReviewBucket}</div> : null}
                    </TableCell>
                    <TableCell className="text-xs">{item.isRecurring ? `${item.recurrenceCount}x` : "--"}</TableCell>
                    <TableCell>
                      <IncidentReviewStatusBadge status={item.reviewStatus} />
                    </TableCell>
                    <TableCell>
                      <SupervisionIncidentOutcomeBadge outcome={item.outcome} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.attentionReasons.map((reason) => (
                          <Badge key={reason} variant="outline" className="text-[11px] font-normal">
                            {attentionReasonLabel(reason)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {queue.data ? <PaginationBar pagination={queue.data.pagination} onPageChange={setPage} /> : null}
      </CardContent>

      <SupervisionIncidentDetailDialog auditLogId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
    </Card>
  );
}
