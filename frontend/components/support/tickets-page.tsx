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
import { CategoryManagerDialog } from "@/components/support/category-manager-dialog";
import { PriorityBadge, TicketStatusBadge } from "@/components/support/status-badge";
import { TicketForm } from "@/components/support/ticket-form";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCreateTicket, useTickets } from "@/hooks/support/use-tickets";
import { formatDate } from "@/lib/support/format";
import type { TicketFormValues } from "@/lib/validation/support-schema";
import { toErrorMessage } from "@/services/http";
import { PRIORITIES, TICKET_STATUSES, type Priority, type TicketStatus } from "@/types/support";
import { PRIORITY_LABELS, TICKET_STATUS_LABELS } from "@/lib/support/format";

const LIMIT = 20;

export function TicketsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useTickets({
    page,
    limit: LIMIT,
    search: search || undefined,
    status: status === "all" ? undefined : status,
    priority: priority === "all" ? undefined : priority,
  });

  const createTicket = useCreateTicket();

  async function handleCreate(values: TicketFormValues) {
    try {
      const { data: ticket } = await createTicket.mutateAsync(values);
      toast.success("Chamado criado com sucesso.");
      setSheetOpen(false);
      router.push(`/support/${ticket.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar chamado."));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suporte</h1>
          <p className="text-sm text-muted-foreground">Chamados e atendimento a clientes.</p>
        </div>
        <div className="flex items-center gap-2">
          <CategoryManagerDialog />
          <PermissionGate permission="support.create">
            <Button onClick={() => setSheetOpen(true)}>
              <Plus /> Novo chamado
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
              placeholder="Buscar por título ou descrição"
              className="pl-8"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as TicketStatus | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {TICKET_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {TICKET_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priority}
            onValueChange={(value) => {
              setPage(1);
              setPriority(value as Priority | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as prioridades</SelectItem>
              {PRIORITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {PRIORITY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState label="Carregando chamados..." />
          ) : isError || !data ? (
            <ErrorState onRetry={() => refetch()} />
          ) : data.data.length === 0 ? (
            <EmptyState
              title="Nenhum chamado encontrado"
              description="Ajuste os filtros ou abra o primeiro chamado."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Título</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Vencimento SLA</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((ticket) => (
                    <TableRow
                      key={ticket.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/support/${ticket.id}`)}
                    >
                      <TableCell className="font-medium">{ticket.title}</TableCell>
                      <TableCell>{ticket.clientName}</TableCell>
                      <TableCell>{ticket.categoryName}</TableCell>
                      <TableCell>
                        <PriorityBadge priority={ticket.priority} />
                      </TableCell>
                      <TableCell>{ticket.ownerName ?? "--"}</TableCell>
                      <TableCell>{formatDate(ticket.slaDueAt)}</TableCell>
                      <TableCell>
                        <TicketStatusBadge status={ticket.status} />
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
            <SheetTitle>Novo chamado</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <TicketForm onSubmit={handleCreate} submitLabel="Criar chamado" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
