"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, History, Pencil, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PermissionGate } from "@/components/auth/permission-gate";
import { EntryForm } from "@/components/financial/entry-form";
import { PaymentForm } from "@/components/financial/payment-form";
import { EntryStatusBadge, EntryTypeBadge } from "@/components/financial/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useEntry, useEntryHistory, useUpdateEntry } from "@/hooks/financial/use-entries";
import { useCreatePayment, usePayments } from "@/hooks/financial/use-payments";
import { canRegisterPayment } from "@/lib/financial/derived";
import {
  ENTRY_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/financial/format";
import type { EntryFormValues, PaymentFormValues } from "@/lib/validation/financial-schema";
import { toErrorMessage } from "@/services/http";

function AuditHistorySection({ entryId }: { entryId: number }) {
  const historyQuery = useEntryHistory(entryId);

  if (historyQuery.isLoading) {
    return <LoadingState label="Carregando histórico..." />;
  }

  if (historyQuery.isError || !historyQuery.data) {
    return <ErrorState onRetry={() => historyQuery.refetch()} />;
  }

  if (historyQuery.data.data.length === 0) {
    return <EmptyState title="Nenhum evento registrado" description="O histórico aparece aqui conforme o lançamento é alterado." />;
  }

  return (
    <ul className="space-y-2">
      {historyQuery.data.data.map((event) => (
        <li key={event.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{event.action}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span>
            </div>
            {event.userName ? <p className="text-xs text-muted-foreground">Por {event.userName}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function EntryDetailPage({ entryId }: { entryId: number }) {
  const [editing, setEditing] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const entryQuery = useEntry(entryId);
  const paymentsQuery = usePayments(entryId);
  const updateEntry = useUpdateEntry(entryId);
  const createPayment = useCreatePayment(entryId);

  if (entryQuery.isLoading) {
    return <LoadingState label="Carregando lançamento..." />;
  }

  if (entryQuery.isError || !entryQuery.data) {
    return <ErrorState onRetry={() => entryQuery.refetch()} />;
  }

  const entry = entryQuery.data.data;

  async function handleUpdate(values: EntryFormValues) {
    try {
      await updateEntry.mutateAsync(values);
      toast.success("Lançamento atualizado com sucesso.");
      setEditing(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar lançamento."));
    }
  }

  async function handlePayment(values: PaymentFormValues) {
    try {
      await createPayment.mutateAsync(values);
      toast.success("Pagamento registrado com sucesso.");
      setPaymentDialogOpen(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao registrar pagamento."));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/financial" />} className="mb-2 -ml-2">
          <ArrowLeft /> Financeiro
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{entry.description}</h1>
              <EntryTypeBadge type={entry.type} />
              <EntryStatusBadge status={entry.status} isOverdue={entry.isOverdue} />
            </div>
            <p className="text-sm text-muted-foreground">
              {entry.categoryName}
              {entry.clientName ? ` · ${entry.clientName}` : ""}
              {entry.projectName ? ` · ${entry.projectName}` : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <PermissionGate permission="financial.pay">
              <Button
                variant="outline"
                disabled={!canRegisterPayment(entry)}
                onClick={() => setPaymentDialogOpen(true)}
              >
                <Wallet /> Registrar pagamento
              </Button>
            </PermissionGate>
            <PermissionGate permission="financial.update">
              <Button variant="outline" onClick={() => setEditing((value) => !value)}>
                <Pencil /> {editing ? "Cancelar edição" : "Editar"}
              </Button>
            </PermissionGate>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            {editing ? (
              <EntryForm
                defaultValues={{
                  type: entry.type,
                  categoryId: entry.categoryId,
                  clientId: entry.clientId ?? undefined,
                  projectId: entry.projectId ?? undefined,
                  description: entry.description,
                  amount: Number(entry.amount),
                  issueDate: entry.issueDate,
                  dueDate: entry.dueDate,
                  competenceDate: entry.competenceDate,
                  paymentMethod: entry.paymentMethod ?? undefined,
                  reference: entry.reference ?? undefined,
                  notes: entry.notes ?? undefined,
                }}
                onSubmit={handleUpdate}
                submitLabel="Salvar alterações"
              />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Valor</dt>
                  <dd className="font-medium">{formatCurrency(entry.amount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Saldo restante</dt>
                  <dd className="font-medium">{formatCurrency(entry.remainingAmount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Emissão</dt>
                  <dd>{formatDate(entry.issueDate)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vencimento</dt>
                  <dd>{formatDate(entry.dueDate)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Competência</dt>
                  <dd>{formatDate(entry.competenceDate)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pago em</dt>
                  <dd>{entry.paidAt ? formatDateTime(entry.paidAt) : "--"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Forma de pagamento</dt>
                  <dd>{entry.paymentMethod ? PAYMENT_METHOD_LABELS[entry.paymentMethod] : "--"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Referência</dt>
                  <dd>{entry.reference ?? "--"}</dd>
                </div>
                {entry.notes ? (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Observações</dt>
                    <dd className="whitespace-pre-wrap">{entry.notes}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p className="text-muted-foreground">Status</p>
            <p className="font-medium">{ENTRY_STATUS_LABELS[entry.status]}</p>
            <p className="text-muted-foreground">Valor pago</p>
            <p className="font-medium">{formatCurrency(entry.paidAmount)}</p>
            <p className="text-muted-foreground">Saldo restante</p>
            <p className="font-medium">{formatCurrency(entry.remainingAmount)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-medium">Pagamentos</h2>
          {paymentsQuery.isLoading ? (
            <LoadingState label="Carregando pagamentos..." />
          ) : paymentsQuery.isError || !paymentsQuery.data ? (
            <ErrorState onRetry={() => paymentsQuery.refetch()} />
          ) : paymentsQuery.data.data.length === 0 ? (
            <EmptyState title="Nenhum pagamento registrado" description="Os pagamentos aparecem aqui conforme forem registrados." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Referência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentsQuery.data.data.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{formatDateTime(payment.paidAt)}</TableCell>
                      <TableCell>{formatCurrency(payment.amount)}</TableCell>
                      <TableCell>
                        {payment.paymentMethod ? PAYMENT_METHOD_LABELS[payment.paymentMethod] : "--"}
                      </TableCell>
                      <TableCell>{payment.reference ?? "--"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-medium">Histórico</h2>
          <AuditHistorySection entryId={entryId} />
        </CardContent>
      </Card>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
          </DialogHeader>
          <PaymentForm
            amount={entry.amount}
            paidAmount={entry.paidAmount}
            remainingAmount={entry.remainingAmount}
            onSubmit={handlePayment}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
