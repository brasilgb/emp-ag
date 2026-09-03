"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useOperationalHealth, useOperationalIncidents, useRunOperationalSupervision } from "@/hooks/agents/use-operations-supervisor";
import { formatAgeSeconds, operationalIncidentTypeLabel } from "@/lib/agents/derived";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";
import type { OperationalIncidentResult, OperationalIncident } from "@/types/agents";

import { OperationalHealthStatusBadge, OperationalResponseBadge, OperationalSeverityBadge } from "../status-badge";

/**
 * Agentes v2.5 (correio.md seções 24-26) — tela ADMINISTRATIVA/
 * OPERACIONAL, nunca cotidiana. "Simular supervisão" (dry-run) não exige
 * confirmação (sem custo real); "Executar supervisão" exige diálogo de
 * confirmação explícito, deixando claro que pode disparar recoveries já
 * autorizados, restringir autonomia em condições de segurança, e criar
 * itens de atenção humana — nunca apresentado como "IA vai corrigir tudo".
 */
export function OperationsSupervisorDashboard() {
  const healthQuery = useOperationalHealth();
  const incidentsQuery = useOperationalIncidents();
  const supervise = useRunOperationalSupervision();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResults, setLastResults] = useState<OperationalIncidentResult[] | null>(null);

  async function handleSimulate() {
    try {
      const { data } = await supervise.mutateAsync(true);
      setLastResults(data.results);
      toast.success(`Simulação concluída: ${data.incidentsDetected} incidente(s) detectado(s).`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao simular supervisão."));
    }
  }

  async function handleRunReal() {
    try {
      const { data } = await supervise.mutateAsync(false);
      setLastResults(data.results);
      setConfirmOpen(false);
      toast.success(`Supervisão executada: ${data.recovered} recuperado(s), ${data.autonomyRestricted} autonomia(s) restrita(s), ${data.escalated} escalado(s).`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao executar supervisão."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Saúde operacional</h3>
          {healthQuery.data ? <OperationalHealthStatusBadge status={healthQuery.data.data.status} /> : null}
        </CardHeader>
        <CardContent>
          {healthQuery.isLoading ? (
            <LoadingState label="Carregando saúde operacional..." />
          ) : healthQuery.isError || !healthQuery.data ? (
            <ErrorState onRetry={() => healthQuery.refetch()} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatBox label="Incidentes ativos" value={healthQuery.data.data.summary.activeIncidents} />
              <StatBox label="Incidentes críticos" value={healthQuery.data.data.summary.criticalIncidents} highlight={healthQuery.data.data.summary.criticalIncidents > 0} />
              <StatBox label="Stale workflows" value={healthQuery.data.data.summary.staleWorkflows} />
              <StatBox label="Jobs com falhas" value={healthQuery.data.data.summary.failingJobs} />
              <StatBox label="Falhas de delivery" value={healthQuery.data.data.summary.failingDeliveries} />
              <StatBox label="Atenção humana pendente" value={healthQuery.data.data.summary.manualAttentionPending} highlight={healthQuery.data.data.summary.manualAttentionPending > 0} />
              <StatBox label="Gerado em" value={formatDateTime(healthQuery.data.data.generatedAt)} small />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">Incidentes</h3>
          <PermissionGate permission="agents.operations.manage">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={supervise.isPending} onClick={handleSimulate}>
                Simular supervisão
              </Button>
              <Button size="sm" disabled={supervise.isPending} onClick={() => setConfirmOpen(true)}>
                Executar supervisão
              </Button>
            </div>
          </PermissionGate>
        </CardHeader>
        <CardContent className="space-y-3">
          {incidentsQuery.isLoading ? (
            <LoadingState label="Carregando incidentes..." />
          ) : incidentsQuery.isError || !incidentsQuery.data ? (
            <ErrorState onRetry={() => incidentsQuery.refetch()} />
          ) : incidentsQuery.data.data.length === 0 ? (
            <EmptyState title="Nenhum incidente" description="Todos os sistemas operacionais estão saudáveis." />
          ) : (
            <IncidentsTable incidents={incidentsQuery.data.data} results={lastResults} />
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar supervisão real?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Esta operação poderá executar recoveries previamente autorizados, restringir autonomia em condições de segurança e criar itens de atenção
              humana. Nenhuma tool é executada, nenhuma permission é alterada, autonomia nunca é aumentada.
            </p>
            <p className="text-muted-foreground">Recomendado simular antes, se ainda não simulou.</p>
            <Button className="w-full" disabled={supervise.isPending} onClick={handleRunReal}>
              Confirmar e executar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBox({ label, value, small, highlight }: { label: string; value: string | number; small?: boolean; highlight?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={small ? "text-xs" : `font-medium ${highlight ? "text-amber-700 dark:text-amber-400" : ""}`}>{value}</p>
    </div>
  );
}

function IncidentsTable({ incidents, results }: { incidents: OperationalIncident[]; results: OperationalIncidentResult[] | null }) {
  // Fechamento v2.8 (lint react-hooks/purity) — `Date.now()` nunca é
  // chamado diretamente no corpo do render; `useState` com inicializador
  // lazy roda uma única vez, na montagem, nunca durante um re-render.
  const [now] = useState(() => Date.now());

  function resultFor(incident: OperationalIncident): OperationalIncidentResult | undefined {
    return results?.find((result) => result.incidentId === incident.id);
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Severity</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Problem</TableHead>
            <TableHead>Detected</TableHead>
            <TableHead>Recommended response</TableHead>
            <TableHead>Current state</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((incident) => {
            const result = resultFor(incident);
            return (
              <TableRow key={incident.id}>
                <TableCell>
                  <OperationalSeverityBadge severity={incident.severity} />
                </TableCell>
                <TableCell className="text-xs">{operationalIncidentTypeLabel(incident.type)}</TableCell>
                <TableCell className="text-xs">
                  {incident.entityType} #{incident.entityId}
                </TableCell>
                <TableCell className="max-w-80 text-xs text-muted-foreground">{incident.problem}</TableCell>
                <TableCell className="text-xs">{formatAgeSeconds(Math.floor((now - new Date(incident.detectedAt).getTime()) / 1000))}</TableCell>
                <TableCell>{result ? <OperationalResponseBadge response={result.response} /> : <span className="text-xs text-muted-foreground">--</span>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{result?.outcome ?? "--"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
