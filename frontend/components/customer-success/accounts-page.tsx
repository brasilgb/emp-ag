"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PaginationBar } from "@/components/crm/pagination-bar";
import { ChurnRiskBadge, CsAccountStatusBadge, OnboardingStatusBadge } from "@/components/customer-success/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useClients } from "@/hooks/crm/use-clients";
import { useCSAccounts, useCreateCSAccount } from "@/hooks/customer-success/use-cs-accounts";
import { formatDate } from "@/lib/customer-success/format";
import { toErrorMessage } from "@/services/http";
import { CHURN_RISKS, CS_ACCOUNT_STATUSES, type ChurnRisk, type CsAccountStatus } from "@/types/customer-success";
import { CHURN_RISK_LABELS, CS_ACCOUNT_STATUS_LABELS } from "@/lib/customer-success/format";

const LIMIT = 20;

function CreateAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const clientsQuery = useClients({ limit: 100 });
  const accountsQuery = useCSAccounts({ limit: 100 });
  const createAccount = useCreateCSAccount();
  const [clientId, setClientId] = useState<string | undefined>(undefined);

  const existingClientIds = new Set(accountsQuery.data?.data.map((account) => account.clientId));
  const availableClients = clientsQuery.data?.data.filter((client) => !existingClientIds.has(client.id)) ?? [];

  async function handleCreate() {
    if (!clientId) return;

    try {
      const { data: account } = await createAccount.mutateAsync(Number(clientId));
      toast.success("Conta de Customer Success criada.");
      onOpenChange(false);
      router.push(`/customer-success/${account.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar conta."));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conta de Customer Success</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="clientId">Cliente</Label>
            <Select
              value={clientId}
              onValueChange={(value) => setClientId(value ?? undefined)}
              disabled={clientsQuery.isLoading}
            >
              <SelectTrigger id="clientId" className="w-full">
                <SelectValue placeholder="Selecione um cliente sem conta" />
              </SelectTrigger>
              <SelectContent>
                {availableClients.map((client) => (
                  <SelectItem key={client.id} value={String(client.id)}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!clientId || createAccount.isPending}>
            Criar conta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AccountsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CsAccountStatus | "all">("all");
  const [churnRisk, setChurnRisk] = useState<ChurnRisk | "all">("all");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useCSAccounts({
    page,
    limit: LIMIT,
    search: search || undefined,
    status: status === "all" ? undefined : status,
    churnRisk: churnRisk === "all" ? undefined : churnRisk,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer Success</h1>
          <p className="text-sm text-muted-foreground">Saúde, onboarding e retenção dos clientes.</p>
        </div>
        <PermissionGate permission="cs.update">
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus /> Nova conta
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
              placeholder="Buscar por cliente"
              className="pl-8"
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setPage(1);
              setStatus(value as CsAccountStatus | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {CS_ACCOUNT_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {CS_ACCOUNT_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={churnRisk}
            onValueChange={(value) => {
              setPage(1);
              setChurnRisk(value as ChurnRisk | "all");
            }}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo risco</SelectItem>
              {CHURN_RISKS.map((value) => (
                <SelectItem key={value} value={value}>
                  {CHURN_RISK_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <LoadingState label="Carregando contas..." />
          ) : isError || !data ? (
            <ErrorState onRetry={() => refetch()} />
          ) : data.data.length === 0 ? (
            <EmptyState title="Nenhuma conta encontrada" description="Ajuste os filtros ou crie a primeira conta." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Health Score</TableHead>
                    <TableHead>Onboarding</TableHead>
                    <TableHead>Último contato</TableHead>
                    <TableHead>Próximo contato</TableHead>
                    <TableHead>Satisfação</TableHead>
                    <TableHead>Churn Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((account) => (
                    <TableRow
                      key={account.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/customer-success/${account.id}`)}
                    >
                      <TableCell className="font-medium">{account.clientName}</TableCell>
                      <TableCell>{account.ownerName ?? "--"}</TableCell>
                      <TableCell>
                        <CsAccountStatusBadge status={account.status} />
                      </TableCell>
                      <TableCell>{account.healthScore}</TableCell>
                      <TableCell>
                        <OnboardingStatusBadge status={account.onboardingStatus} />
                      </TableCell>
                      <TableCell>{formatDate(account.lastContactAt)}</TableCell>
                      <TableCell>{formatDate(account.nextContactAt)}</TableCell>
                      <TableCell>{account.satisfactionScore ?? "--"}</TableCell>
                      <TableCell>
                        <ChurnRiskBadge risk={account.churnRisk} />
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

      <CreateAccountDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  );
}
