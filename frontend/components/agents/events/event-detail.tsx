"use client";

import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAgentEvent, useRetryEvent } from "@/hooks/agents/use-agent-events";
import { formatDateTime } from "@/lib/agents/format";
import { toErrorMessage } from "@/services/http";

import { EventDeliveryStatusBadge, EventStatusBadge } from "../status-badge";

/**
 * Correio.md v1.4 seção 23 — detalhe: Event, Payload (somente leitura),
 * Rule matches/Deliveries, Job Runs, Errors. Rastreabilidade completa:
 * Run → Rule → Event.
 */
export function EventDetail({ eventId }: { eventId: number }) {
  const { data, isLoading, isError, refetch } = useAgentEvent(eventId);
  const retry = useRetryEvent();

  if (isLoading) return <LoadingState label="Carregando evento..." />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const { event, deliveries } = data.data;

  async function handleRetry() {
    try {
      await retry.mutateAsync(eventId);
      toast.success("Evento reagendado para reprocessamento.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao reprocessar evento."));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Tipo</p>
            <p className="font-mono text-base">{event.eventType}</p>
          </div>
          <div className="flex items-center gap-2">
            <EventStatusBadge status={event.status} />
            {event.status === "failed" ? (
              <PermissionGate permission="agents.events.manage">
                <Button size="sm" variant="outline" disabled={retry.isPending} onClick={handleRetry}>
                  Reprocessar
                </Button>
              </PermissionGate>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>Origem: {event.source ?? "--"}</span>
            <span>Aggregate: {event.aggregateType ? `${event.aggregateType}#${event.aggregateId}` : "--"}</span>
            <span>Recebido em: {formatDateTime(event.receivedAt)}</span>
            <span>Processado em: {formatDateTime(event.processedAt)}</span>
            <span>Tentativas: {event.attemptCount}</span>
          </div>
          {event.lastError ? (
            <p className="text-xs text-destructive">Último erro: {event.lastError}</p>
          ) : null}

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Payload</p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(event.payload, null, 2)}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <p className="text-sm font-medium">Rule matches / Deliveries ({deliveries.length})</p>
        </CardHeader>
        <CardContent className="p-0">
          {deliveries.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhuma Event Rule casou com este evento.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Erro</TableHead>
                    <TableHead>Run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="text-xs text-muted-foreground">#{delivery.ruleId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">#{delivery.jobId}</TableCell>
                      <TableCell>
                        <EventDeliveryStatusBadge status={delivery.status} />
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                        {delivery.errorMessage ?? "--"}
                      </TableCell>
                      <TableCell>
                        {delivery.jobRunId ? (
                          <Link href={`/agents/jobs/${delivery.jobId}`} className="text-primary underline underline-offset-2">
                            Ver Job
                          </Link>
                        ) : (
                          "--"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Link href="/agents/events" className="text-sm text-primary underline underline-offset-2">
        ← Voltar para todos os eventos
      </Link>
    </div>
  );
}
