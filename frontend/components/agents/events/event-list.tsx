"use client";

import { useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useAgentEvents } from "@/hooks/agents/use-agent-events";
import { formatDateTime } from "@/lib/agents/format";
import { EVENT_STATUS_LABELS } from "@/lib/agents/derived";
import { EVENT_STATUSES, type EventStatus } from "@/types/agents";

import { EventStatusBadge } from "../status-badge";

const LIMIT = 20;

// Correio.md v1.4 seção 23 — lista de events: tipo, origem, status, data,
// tentativas. Matched rules/runs gerados ficam no detalhe.
export function EventList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<EventStatus | "all">("all");

  const { data, isLoading, isError, refetch } = useAgentEvents({
    page,
    limit: LIMIT,
    status: status === "all" ? undefined : status,
  });

  return (
    <Card>
      <CardHeader>
        <Select
          value={status}
          onValueChange={(value) => {
            setPage(1);
            setStatus((value as EventStatus | "all") ?? "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {EVENT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {EVENT_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando eventos..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhum evento registrado" description="Eventos publicados por operações de negócio aparecerão aqui." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recebido em</TableHead>
                  <TableHead>Tentativas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/agents/events/${event.id}`} className="text-primary underline underline-offset-2">
                        {event.eventType}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{event.source ?? "--"}</TableCell>
                    <TableCell>
                      <EventStatusBadge status={event.status} />
                    </TableCell>
                    <TableCell>{formatDateTime(event.receivedAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{event.attemptCount}</TableCell>
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
