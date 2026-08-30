"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { LeadStatusBadge } from "@/components/crm/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useLeads } from "@/hooks/crm/use-leads";
import { formatCurrency, formatDate, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/crm/format";
import { LEAD_SOURCES, type LeadSource } from "@/types/crm";

const LIMIT = 20;

export function LeadsTable() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<LeadSource | "all">("all");

  const { data, isLoading, isError, refetch } = useLeads({
    page,
    limit: LIMIT,
    search: search || undefined,
    source: source === "all" ? undefined : source,
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Buscar por nome, empresa ou e-mail"
            className="pl-8"
          />
        </div>
        <Select
          value={source}
          onValueChange={(value) => {
            setPage(1);
            setSource(value as LeadSource | "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            {LEAD_SOURCES.map((value) => (
              <SelectItem key={value} value={value}>
                {LEAD_SOURCE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando leads..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState title="Nenhum lead encontrado" description="Ajuste os filtros ou cadastre um novo lead." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Estágio</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Próxima ação</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((lead) => (
                  <TableRow key={lead.id} className="cursor-pointer" onClick={() => router.push(`/leads/${lead.id}`)}>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell>{lead.companyName ?? "--"}</TableCell>
                    <TableCell>{lead.stageName}</TableCell>
                    <TableCell>{LEAD_SOURCE_LABELS[lead.source]}</TableCell>
                    <TableCell>{lead.ownerName ?? "--"}</TableCell>
                    <TableCell>{formatCurrency(lead.estimatedValue)}</TableCell>
                    <TableCell>{formatDate(lead.nextActionAt)}</TableCell>
                    <TableCell>
                      <LeadStatusBadge status={lead.status} label={LEAD_STATUS_LABELS[lead.status]} />
                    </TableCell>
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
