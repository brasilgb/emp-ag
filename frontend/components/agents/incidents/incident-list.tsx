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
import { useIncidents } from "@/hooks/agents/use-operations";
import { formatDateTime } from "@/lib/agents/format";
import { incidentTypeLabel } from "@/lib/agents/derived";
import { INCIDENT_TYPES, type IncidentType } from "@/types/agents";

import { IncidentTypeBadge } from "../status-badge";

const LIMIT = 20;

// Agentes v1.6 (correio.md seção 6) — Incident Center. Nenhum dado é
// persistido para esta tela: tudo derivado ao vivo pelo backend
// (agents/incidents/service.ts) a partir de autonomy blocks, deliveries
// falhas e Runs repetidamente falhos.
export function IncidentList() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<IncidentType | "all">("all");

  const { data, isLoading, isError, refetch } = useIncidents({
    page,
    limit: LIMIT,
    type: type === "all" ? undefined : type,
  });

  return (
    <Card>
      <CardHeader>
        <Select
          value={type}
          onValueChange={(value) => {
            setPage(1);
            setType((value as IncidentType | "all") ?? "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {INCIDENT_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {incidentTypeLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando incidentes..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhum incidente" description="Nenhum bloqueio, ciclo ou falha repetida no filtro atual." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Resumo</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Ocorreu em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((incident) => (
                  <TableRow key={incident.id}>
                    <TableCell>
                      <IncidentTypeBadge type={incident.type} />
                    </TableCell>
                    <TableCell className="text-sm">{incident.summary}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {incident.jobId ? (
                        <Link href={`/agents/jobs/${incident.jobId}`} className="text-primary underline underline-offset-2">
                          #{incident.jobId}
                        </Link>
                      ) : (
                        "--"
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(incident.occurredAt)}</TableCell>
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
