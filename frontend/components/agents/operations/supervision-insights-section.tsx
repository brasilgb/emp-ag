"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useRecurringIncidents, useSupervisionIncidentDetail, useSupervisionIncidents, useSupervisionOverview, useUpdateIncidentReview } from "@/hooks/agents/use-operations";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { incidentReviewStatusLabel, operationalIncidentTypeLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";
import {
  INCIDENT_REVIEW_STATUSES,
  INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED,
  OPERATIONAL_INCIDENT_TYPES,
  OPERATIONAL_RESPONSES,
  OPERATIONAL_SEVERITIES,
  type IncidentReviewStatus,
  type IncidentReviewStatusOrUnreviewed,
  type OperationalIncidentType,
  type OperationalResponse,
  type OperationalSeverity,
} from "@/types/agents";

import { IncidentReviewStatusBadge, OperationalIncidentTypeBadge, OperationalResponseBadge, OperationalSeverityBadge, SupervisionIncidentOutcomeBadge } from "../status-badge";

const LIMIT = 20;

/**
 * Agentes v3.5 (correio.md "Operational Supervision Insights & Incident
 * Review") — evolui a MESMA seção de Supervisão Operacional (nunca uma
 * página nova): visão consolidada + histórico pesquisável + detalhe de
 * incidente + recorrência. "Indicadores operacionais simples e legíveis...
 * evitar gráficos decorativos sem valor operacional" (correio.md seção 6)
 * — só números/cards/tabela, nenhuma biblioteca de gráficos.
 */
export function SupervisionInsightsSection() {
  const overview = useSupervisionOverview();
  const recurring = useRecurringIncidents();

  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState<OperationalSeverity | "all">("all");
  const [incidentType, setIncidentType] = useState<OperationalIncidentType | "all">("all");
  const [response, setResponse] = useState<OperationalResponse | "all">("all");
  const [reviewStatus, setReviewStatus] = useState<IncidentReviewStatusOrUnreviewed | "all">("all");
  const [detailId, setDetailId] = useState<number | null>(null);

  const incidents = useSupervisionIncidents({
    page,
    limit: LIMIT,
    severity: severity === "all" ? undefined : severity,
    incidentType: incidentType === "all" ? undefined : incidentType,
    response: response === "all" ? undefined : response,
    reviewStatus: reviewStatus === "all" ? undefined : reviewStatus,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Visão consolidada da supervisão</h3>
        </CardHeader>
        <CardContent>
          {overview.isLoading ? (
            <LoadingState label="Carregando visão consolidada..." />
          ) : overview.isError || !overview.data ? (
            <ErrorState onRetry={() => overview.refetch()} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatBox label="Execuções (runs)" value={overview.data.data.totalRuns} />
              <StatBox label="Achados (findings)" value={overview.data.data.totalFindings} />
              <StatBox label="Incidentes detectados" value={overview.data.data.totalIncidentsDetected} />
              <StatBox label="Recuperados" value={overview.data.data.responsesApplied.recovered} />
              <StatBox label="Autonomia restrita" value={overview.data.data.responsesApplied.autonomyRestricted} />
              <StatBox label="Escalados" value={overview.data.data.responsesApplied.escalated} />
              <StatBox label="Falhas" value={overview.data.data.responsesApplied.failed} highlight={overview.data.data.responsesApplied.failed > 0} />
              <StatBox label="Incidentes críticos" value={overview.data.data.incidentsBySeverity.critical} highlight={overview.data.data.incidentsBySeverity.critical > 0} />
              <StatBox label="Escalations criadas" value={overview.data.data.escalationsCreated} />
              <StatBox label="Incidentes recorrentes" value={overview.data.data.recurringIncidentsCount} highlight={overview.data.data.recurringIncidentsCount > 0} />
              <StatBox label="Não revisados" value={overview.data.data.reviewsByStatus.unreviewed} highlight={overview.data.data.reviewsByStatus.unreviewed > 0} />
              <StatBox label="Reconhecidos" value={overview.data.data.reviewsByStatus.acknowledged} />
              <StatBox label="Resolvidos (review)" value={overview.data.data.reviewsByStatus.resolved} />
              <StatBox label="Dispensados" value={overview.data.data.reviewsByStatus.dismissed} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Histórico de incidentes</h3>
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
              value={response}
              onValueChange={(value) => {
                setPage(1);
                setResponse((value as OperationalResponse | "all") ?? "all");
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda resposta</SelectItem>
                {OPERATIONAL_RESPONSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
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
                <SelectItem value="all">Todo review</SelectItem>
                {INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED.map((value) => (
                  <SelectItem key={value} value={value}>
                    {incidentReviewStatusLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {incidents.isLoading ? (
            <LoadingState label="Carregando histórico de incidentes..." />
          ) : incidents.isError || !incidents.data ? (
            <ErrorState onRetry={() => incidents.refetch()} />
          ) : incidents.data.data.length === 0 ? (
            <EmptyState title="Nenhum incidente" description="Nenhum incidente corresponde aos filtros selecionados." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Detectado em</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Entidade</TableHead>
                    <TableHead>Severidade</TableHead>
                    <TableHead>Resposta</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Escalation</TableHead>
                    <TableHead>Review</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.data.data.map((incident) => (
                    <TableRow key={incident.auditLogId} className="cursor-pointer" onClick={() => setDetailId(incident.auditLogId)}>
                      <TableCell className="text-xs">{formatDateTime(incident.detectedAt)}</TableCell>
                      <TableCell>
                        <OperationalIncidentTypeBadge type={incident.incidentType} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {incident.entityType} #{incident.entityId}
                      </TableCell>
                      <TableCell>
                        <OperationalSeverityBadge severity={incident.severity} />
                      </TableCell>
                      <TableCell>
                        <OperationalResponseBadge response={incident.response} />
                      </TableCell>
                      <TableCell>
                        <SupervisionIncidentOutcomeBadge outcome={incident.outcome} />
                      </TableCell>
                      <TableCell className="text-xs">{incident.hasEscalation ? "Sim" : "--"}</TableCell>
                      <TableCell>
                        <IncidentReviewStatusBadge status={incident.reviewStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {incidents.data ? <PaginationBar pagination={incidents.data.pagination} onPageChange={setPage} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Incidentes recorrentes</h3>
        </CardHeader>
        <CardContent className="p-0">
          {recurring.isLoading ? (
            <LoadingState label="Carregando recorrências..." />
          ) : recurring.isError || !recurring.data ? (
            <ErrorState onRetry={() => recurring.refetch()} />
          ) : recurring.data.data.length === 0 ? (
            <EmptyState title="Nenhuma recorrência" description="Nenhum incidente se repetiu em mais de um scan até o momento." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Entidade</TableHead>
                    <TableHead>Ocorrências</TableHead>
                    <TableHead>Primeira vez</TableHead>
                    <TableHead>Última vez</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recurring.data.data.map((row) => (
                    <TableRow key={`${row.incidentType}:${row.entityType}:${row.entityId}`}>
                      <TableCell>
                        <OperationalIncidentTypeBadge type={row.incidentType} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.entityType} #{row.entityId}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{row.occurrences}x</TableCell>
                      <TableCell className="text-xs">{formatDateTime(row.firstSeenAt)}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(row.lastSeenAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <SupervisionIncidentDetailDialog auditLogId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />
    </div>
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

// Exportado para reuso pela fila Needs Attention (v3.7,
// attention-queue-section.tsx) — correio.md: "não criar segunda
// implementação de review no frontend". Mesmo diálogo, mesma seção de
// review humano (`IncidentReviewSection` abaixo), em ambos os lugares.
export function SupervisionIncidentDetailDialog({ auditLogId, onOpenChange }: { auditLogId: number | null; onOpenChange: (open: boolean) => void }) {
  const detailQuery = useSupervisionIncidentDetail(auditLogId);

  return (
    <Dialog open={auditLogId !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Incidente #{auditLogId}</DialogTitle>
        </DialogHeader>

        {detailQuery.isLoading ? (
          <LoadingState label="Carregando incidente..." />
        ) : detailQuery.isError || !detailQuery.data ? (
          <ErrorState onRetry={() => detailQuery.refetch()} />
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">{detailQuery.data.data.problem}</p>

            <dl className="grid grid-cols-2 gap-3">
              <DetailField label="Origem" value={`${detailQuery.data.data.entityType} #${detailQuery.data.data.entityId}`} />
              <DetailField label="Tipo" value={<OperationalIncidentTypeBadge type={detailQuery.data.data.incidentType} />} />
              <DetailField label="Severidade" value={<OperationalSeverityBadge severity={detailQuery.data.data.severity} />} />
              <DetailField label="Detectado em" value={formatDateTime(detailQuery.data.data.detectedAt)} />
              {/* Agentes v3.6 — "Resultado operacional" (o que o Supervisor
                  fez sozinho) fica agrupado aqui; "Review humano" ganha sua
                  PRÓPRIA seção abaixo (correio.md seção 8: nunca misturar
                  as duas dimensões). */}
              <DetailField label="Decisão (resposta)" value={<OperationalResponseBadge response={detailQuery.data.data.response} />} />
              <DetailField label="Resultado operacional" value={<SupervisionIncidentOutcomeBadge outcome={detailQuery.data.data.outcome} />} />
              <DetailField label="Run de origem" value={detailQuery.data.data.runId ?? "--"} />
              {detailQuery.data.data.reason ? <DetailField label="Motivo do resultado" value={detailQuery.data.data.reason} /> : null}
              {detailQuery.data.data.errorMessage ? <DetailField label="Erro" value={<span className="text-red-700 dark:text-red-400">{detailQuery.data.data.errorMessage}</span>} /> : null}
            </dl>

            {detailQuery.data.data.escalation ? (
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">Escalation relacionada</p>
                <p className="mt-1 text-xs">
                  #{detailQuery.data.data.escalation.id} — status {detailQuery.data.data.escalation.status} — criada em {formatDateTime(detailQuery.data.data.escalation.createdAt)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{detailQuery.data.data.escalation.reason}</p>
              </div>
            ) : null}

            <IncidentReviewSection auditLogId={detailQuery.data.data.auditLogId} review={detailQuery.data.data.review} />

            {detailQuery.data.data.auditRefs.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Referências de auditoria</p>
                <ul className="mt-1 space-y-1">
                  {detailQuery.data.data.auditRefs.map((ref) => (
                    <li key={ref.id} className="text-xs text-muted-foreground">
                      #{ref.id} — {ref.action} — {formatDateTime(ref.createdAt)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const REVIEW_ACTION_LABELS: Record<IncidentReviewStatus, string> = {
  acknowledged: "Reconhecer",
  resolved: "Marcar resolvido",
  dismissed: "Dispensar",
};

/**
 * Agentes v3.6 (correio.md "Operational Incident Acknowledgement & Review
 * Workflow", seção 9) — "Review humano" como seção PRÓPRIA do diálogo,
 * nunca misturada ao resultado operacional acima. Ações só visíveis com
 * `agents.operations.manage` (mesma permission de escrita já usada por
 * `POST /operations/supervise`/`PATCH /operations/scheduler` — nenhuma
 * permission nova).
 */
function IncidentReviewSection({ auditLogId, review }: { auditLogId: number; review: { status: IncidentReviewStatusOrUnreviewed; reviewedBy: number | null; reviewedAt: string | null; note: string | null } }) {
  const usersQuery = useUsersDirectory();
  const updateReview = useUpdateIncidentReview(auditLogId);
  const [note, setNote] = useState("");

  const reviewerName = review.reviewedBy ? (usersQuery.data?.data.find((user) => user.id === review.reviewedBy)?.name ?? `Usuário #${review.reviewedBy}`) : null;

  async function handleAction(status: IncidentReviewStatus) {
    try {
      await updateReview.mutateAsync({ status, note: note.trim() || undefined });
      setNote("");
      toast.success(`Incidente marcado como "${incidentReviewStatusLabel(status)}".`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar o review do incidente."));
    }
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Review humano</p>
        <IncidentReviewStatusBadge status={review.status} />
      </div>

      {review.reviewedBy ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Revisado por {reviewerName ?? "..."} {review.reviewedAt ? `em ${formatDateTime(review.reviewedAt)}` : ""}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Nenhuma revisão humana registrada ainda — isso é válido mesmo quando o resultado operacional já foi tratado automaticamente.</p>
      )}

      {review.note ? <p className="mt-2 rounded bg-muted p-2 text-xs">{review.note}</p> : null}

      <PermissionGate permission="agents.operations.manage">
        <div className="mt-3 space-y-2">
          <Textarea
            placeholder="Nota opcional (visível só para quem tem acesso a esta tela)..."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={2}
            className="text-xs"
          />
          <div className="flex flex-wrap gap-2">
            {INCIDENT_REVIEW_STATUSES.map((status) => (
              <Button key={status} size="sm" variant={status === review.status ? "default" : "outline"} disabled={updateReview.isPending} onClick={() => handleAction(status)}>
                {REVIEW_ACTION_LABELS[status]}
              </Button>
            ))}
          </div>
        </div>
      </PermissionGate>
    </div>
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
