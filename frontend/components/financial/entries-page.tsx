"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { CategoryManagerDialog } from "@/components/financial/category-manager-dialog";
import { EntryForm } from "@/components/financial/entry-form";
import { EntryStatusBadge, EntryTypeBadge } from "@/components/financial/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCreateEntry, useEntries } from "@/hooks/financial/use-entries";
import { formatCurrency, formatDate } from "@/lib/financial/format";
import type { EntryFormValues } from "@/lib/validation/financial-schema";
import { toErrorMessage } from "@/services/http";
import type { FinancialEntryStatusFilter, FinancialEntryType } from "@/types/financial";

const LIMIT = 20;

export function EntriesPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<FinancialEntryType | "all">("all");
  const [status, setStatus] = useState<FinancialEntryStatusFilter | "all">("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useEntries({
    page,
    limit: LIMIT,
    search: search || undefined,
    type: type === "all" ? undefined : type,
    status: status === "all" ? undefined : status,
  });

  const createEntry = useCreateEntry();

  async function handleCreate(values: EntryFormValues) {
    try {
      const { data: entry } = await createEntry.mutateAsync(values);
      toast.success("Lançamento criado com sucesso.");
      setSheetOpen(false);
      router.push(`/financial/${entry.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar lançamento."));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lançamentos</h1>
          <p className="text-sm text-muted-foreground">Contas a receber e a pagar da agência.</p>
        </div>
        <div className="flex items-center gap-2">
          <CategoryManagerDialog />
          <PermissionGate permission="financial.create">
            <Button onClick={() => setSheetOpen(true)}>
              <Plus /> Novo lançamento
            </Button>
          </PermissionGate>
        </div>
      </div>

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
              placeholder="Buscar por descrição ou referência"
              className="pl-8"
            />
          </div>
          <Select
            value={type}
            onValueChange={(value) => {
              setPage(1);
              setType(value as FinancialEntryType | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="income">Receita</SelectItem>
              <SelectItem value="expense">Despesa</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as FinancialEntryStatusFilter | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="paid">Pago</SelectItem>
              <SelectItem value="overdue">Atrasado</SelectItem>
              <SelectItem value="cancelled">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState label="Carregando lançamentos..." />
          ) : isError || !data ? (
            <ErrorState onRetry={() => refetch()} />
          ) : data.data.length === 0 ? (
            <EmptyState
              title="Nenhum lançamento encontrado"
              description="Ajuste os filtros ou cadastre o primeiro lançamento."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Projeto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((entry) => (
                    <TableRow
                      key={entry.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/financial/${entry.id}`)}
                    >
                      <TableCell className="font-medium">{entry.description}</TableCell>
                      <TableCell>
                        <EntryTypeBadge type={entry.type} />
                      </TableCell>
                      <TableCell>{entry.clientName ?? "--"}</TableCell>
                      <TableCell>{entry.projectName ?? "--"}</TableCell>
                      <TableCell>{entry.categoryName}</TableCell>
                      <TableCell>{formatCurrency(entry.amount)}</TableCell>
                      <TableCell>{formatCurrency(entry.paidAmount)}</TableCell>
                      <TableCell>{formatCurrency(entry.remainingAmount)}</TableCell>
                      <TableCell>{formatDate(entry.dueDate)}</TableCell>
                      <TableCell>
                        <EntryStatusBadge status={entry.status} isOverdue={entry.isOverdue} />
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

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Novo lançamento</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <EntryForm onSubmit={handleCreate} submitLabel="Criar lançamento" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
