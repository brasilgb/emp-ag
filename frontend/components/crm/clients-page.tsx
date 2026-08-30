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
import { ClientForm } from "@/components/crm/client-form";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { ClientStatusBadge } from "@/components/crm/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useClients, useCreateClient } from "@/hooks/crm/use-clients";
import { CLIENT_TYPE_LABELS, CLIENT_STATUS_LABELS } from "@/lib/crm/format";
import type { ClientFormValues } from "@/lib/validation/crm-schema";
import { toErrorMessage } from "@/services/http";
import type { ClientStatus } from "@/types/crm";

const LIMIT = 20;

export function ClientsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ClientStatus | "all">("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useClients({
    page,
    limit: LIMIT,
    search: search || undefined,
    status: status === "all" ? undefined : status,
  });

  const createClient = useCreateClient();

  async function handleCreate(values: ClientFormValues) {
    try {
      const { data: client } = await createClient.mutateAsync(values);
      toast.success("Cliente criado com sucesso.");
      setSheetOpen(false);
      router.push(`/clients/${client.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar cliente."));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">Carteira de clientes da agência.</p>
        </div>
        <PermissionGate permission="clients.create">
          <Button onClick={() => setSheetOpen(true)}>
            <Plus /> Novo Cliente
          </Button>
        </PermissionGate>
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
              placeholder="Buscar por nome, e-mail ou documento"
              className="pl-8"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as ClientStatus | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState label="Carregando clientes..." />
          ) : isError || !data ? (
            <ErrorState onRetry={() => refetch()} />
          ) : data.data.length === 0 ? (
            <EmptyState
              title="Nenhum cliente encontrado"
              description="Ajuste os filtros ou cadastre o primeiro cliente."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((client) => (
                    <TableRow
                      key={client.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/clients/${client.id}`)}
                    >
                      <TableCell className="font-medium">{client.name}</TableCell>
                      <TableCell>{CLIENT_TYPE_LABELS[client.type]}</TableCell>
                      <TableCell>{client.email ?? "--"}</TableCell>
                      <TableCell>{client.phone ?? "--"}</TableCell>
                      <TableCell>
                        <ClientStatusBadge status={client.status} label={CLIENT_STATUS_LABELS[client.status]} />
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
            <SheetTitle>Novo cliente</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">
            <ClientForm onSubmit={handleCreate} submitLabel="Criar cliente" />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
