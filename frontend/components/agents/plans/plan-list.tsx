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
import { useActionPlans } from "@/hooks/agents/use-action-plans";
import { formatDateTime } from "@/lib/agents/format";
import { ACTION_PLAN_STATUS_LABELS } from "@/lib/agents/derived";
import { ACTION_PLAN_STATUSES, type ActionPlanStatus } from "@/types/agents";

import { ActionPlanStatusBadge } from "../status-badge";

const LIMIT = 20;

// Correio.md v1.2 seção 13: lista de planos — objetivo, status,
// solicitante, data. Sem UX sofisticada de propósito.
export function PlanList() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ActionPlanStatus | "all">("all");

  const { data, isLoading, isError, refetch } = useActionPlans({
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
            setStatus(value as ActionPlanStatus | "all");
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {ACTION_PLAN_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {ACTION_PLAN_STATUS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <LoadingState label="Carregando planos..." />
        ) : isError || !data ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="Nenhum plano de ações encontrado"
            description="Planos gerados pelo Diretor Virtual a partir de um objetivo aparecerão aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell className="max-w-96">
                      <Link href={`/agents/plans/${plan.id}`} className="text-primary underline underline-offset-2">
                        {plan.objective}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ActionPlanStatusBadge status={plan.status} />
                    </TableCell>
                    <TableCell>{formatDateTime(plan.createdAt)}</TableCell>
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
