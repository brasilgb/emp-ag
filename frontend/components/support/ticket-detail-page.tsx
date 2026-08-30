"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, History, MessageSquare, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/auth/permission-gate";
import { PriorityBadge, SlaBadge, TicketStatusBadge } from "@/components/support/status-badge";
import { TicketForm } from "@/components/support/ticket-form";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { useCreateMessage, useTicketMessages } from "@/hooks/support/use-ticket-messages";
import { useTicketHistory } from "@/hooks/support/use-ticket-history";
import { useTicket, useUpdateTicket } from "@/hooks/support/use-tickets";
import { slaState } from "@/lib/support/derived";
import { MESSAGE_TYPE_LABELS, formatDateTime } from "@/lib/support/format";
import type { TicketFormValues } from "@/lib/validation/support-schema";
import { toErrorMessage } from "@/services/http";
import { TICKET_STATUSES, type TicketStatus } from "@/types/support";
import { TICKET_STATUS_LABELS } from "@/lib/support/format";

function StatusControl({ ticketId, status }: { ticketId: number; status: TicketStatus }) {
  const updateTicket = useUpdateTicket(ticketId);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolution, setResolution] = useState("");

  const availableStatuses =
    status === "resolved" ? TICKET_STATUSES : TICKET_STATUSES.filter((value) => value !== "closed");

  async function applyStatus(next: TicketStatus, extra?: { resolution?: string }) {
    try {
      await updateTicket.mutateAsync({ status: next, ...extra });
      toast.success("Status atualizado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar status."));
    }
  }

  async function handleChange(value: string | null) {
    if (!value) return;

    const next = value as TicketStatus;

    if (next === "resolved") {
      setResolveDialogOpen(true);
      return;
    }

    await applyStatus(next);
  }

  async function handleResolveSubmit() {
    if (!resolution.trim()) {
      toast.error("Descreva a resolução.");
      return;
    }

    await applyStatus("resolved", { resolution });
    setResolveDialogOpen(false);
    setResolution("");
  }

  return (
    <PermissionGate permission="support.resolve" fallback={<TicketStatusBadge status={status} />}>
      <Select value={status} onValueChange={handleChange} disabled={updateTicket.isPending}>
        <SelectTrigger className="w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableStatuses.map((value) => (
            <SelectItem key={value} value={value}>
              {TICKET_STATUS_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolver chamado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="resolution">Resolução</Label>
              <Textarea
                id="resolution"
                rows={4}
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
              />
            </div>
            <Button className="w-full" onClick={handleResolveSubmit} disabled={updateTicket.isPending}>
              Marcar como resolvido
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PermissionGate>
  );
}

function OwnerControl({ ticketId, ownerUserId }: { ticketId: number; ownerUserId: number | null }) {
  const usersQuery = useUsersDirectory();
  const updateTicket = useUpdateTicket(ticketId);

  async function handleChange(value: string | null) {
    if (!value) return;

    try {
      await updateTicket.mutateAsync({ ownerUserId: value === "none" ? undefined : Number(value) });
      toast.success("Responsável atualizado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atribuir responsável."));
    }
  }

  return (
    <PermissionGate permission="support.assign" fallback={<span>{ownerUserId ?? "Sem responsável"}</span>}>
      <Select
        value={ownerUserId ? String(ownerUserId) : "none"}
        onValueChange={handleChange}
        disabled={usersQuery.isLoading || updateTicket.isPending}
      >
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Sem responsável" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sem responsável</SelectItem>
          {usersQuery.data?.data.map((user) => (
            <SelectItem key={user.id} value={String(user.id)}>
              {user.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </PermissionGate>
  );
}

function MessagesSection({ ticketId }: { ticketId: number }) {
  const messagesQuery = useTicketMessages(ticketId);
  const createMessage = useCreateMessage(ticketId);
  const [content, setContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);

  async function handleSubmit() {
    if (!content.trim()) return;

    try {
      await createMessage.mutateAsync({ content, isInternal, type: isInternal ? "note" : "message" });
      toast.success(isInternal ? "Nota interna adicionada." : "Mensagem enviada.");
      setContent("");
      setIsInternal(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao enviar mensagem."));
    }
  }

  return (
    <div className="space-y-4">
      {messagesQuery.isLoading ? (
        <LoadingState label="Carregando mensagens..." />
      ) : messagesQuery.isError || !messagesQuery.data ? (
        <ErrorState onRetry={() => messagesQuery.refetch()} />
      ) : messagesQuery.data.data.length === 0 ? (
        <EmptyState title="Nenhuma mensagem" description="As mensagens e notas internas aparecem aqui." />
      ) : (
        <ul className="space-y-2">
          {messagesQuery.data.data.map((message) => (
            <li
              key={message.id}
              className={`rounded-lg border p-3 text-sm ${message.isInternal ? "bg-amber-500/5" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <MessageSquare className="size-3.5" />
                  {message.isInternal ? "Nota interna" : MESSAGE_TYPE_LABELS[message.type]}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
              </div>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </li>
          ))}
        </ul>
      )}

      <PermissionGate permission="support.message">
        <div className="space-y-2 border-t pt-4">
          <Textarea
            rows={3}
            placeholder="Escreva uma mensagem ou nota interna..."
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="size-4"
                checked={isInternal}
                onChange={(event) => setIsInternal(event.target.checked)}
              />
              Nota interna (não visível ao cliente)
            </label>
            <Button size="sm" onClick={handleSubmit} disabled={createMessage.isPending}>
              Enviar
            </Button>
          </div>
        </div>
      </PermissionGate>
    </div>
  );
}

function HistorySection({ ticketId }: { ticketId: number }) {
  const historyQuery = useTicketHistory(ticketId);

  if (historyQuery.isLoading) return <LoadingState label="Carregando histórico..." />;
  if (historyQuery.isError || !historyQuery.data) return <ErrorState onRetry={() => historyQuery.refetch()} />;
  if (historyQuery.data.data.length === 0) {
    return <EmptyState title="Nenhum evento registrado" description="O histórico aparece aqui conforme o chamado é alterado." />;
  }

  return (
    <ul className="space-y-2">
      {historyQuery.data.data.map((event) => (
        <li key={event.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{event.event}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TicketDetailPage({ ticketId }: { ticketId: number }) {
  const [editing, setEditing] = useState(false);

  const ticketQuery = useTicket(ticketId);
  const updateTicket = useUpdateTicket(ticketId);

  if (ticketQuery.isLoading) return <LoadingState label="Carregando chamado..." />;
  if (ticketQuery.isError || !ticketQuery.data) return <ErrorState onRetry={() => ticketQuery.refetch()} />;

  const ticket = ticketQuery.data.data;

  async function handleUpdate(values: TicketFormValues) {
    try {
      await updateTicket.mutateAsync(values);
      toast.success("Chamado atualizado com sucesso.");
      setEditing(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar chamado."));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/support" />} className="mb-2 -ml-2">
          <ArrowLeft /> Suporte
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{ticket.title}</h1>
              <PriorityBadge priority={ticket.priority} />
              <SlaBadge state={slaState(ticket)} />
            </div>
            <p className="text-sm text-muted-foreground">
              {ticket.clientName}
              {ticket.projectName ? ` · ${ticket.projectName}` : ""} · {ticket.categoryName}
            </p>
          </div>

          <PermissionGate permission="support.update">
            <Button variant="outline" onClick={() => setEditing((value) => !value)}>
              <Pencil /> {editing ? "Cancelar edição" : "Editar"}
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            {editing ? (
              <TicketForm
                defaultValues={{
                  clientId: ticket.clientId,
                  projectId: ticket.projectId ?? undefined,
                  categoryId: ticket.categoryId,
                  title: ticket.title,
                  description: ticket.description ?? undefined,
                  priority: ticket.priority,
                  source: ticket.source,
                }}
                onSubmit={handleUpdate}
                submitLabel="Salvar alterações"
              />
            ) : (
              <div className="space-y-4 text-sm">
                {ticket.description ? (
                  <p className="whitespace-pre-wrap">{ticket.description}</p>
                ) : (
                  <p className="text-muted-foreground">Sem descrição.</p>
                )}
                {ticket.resolution ? (
                  <div>
                    <p className="font-medium">Resolução</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{ticket.resolution}</p>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6 text-sm">
            <div className="space-y-1.5">
              <p className="text-muted-foreground">Status</p>
              <StatusControl ticketId={ticket.id} status={ticket.status} />
            </div>
            <div className="space-y-1.5">
              <p className="text-muted-foreground">Responsável</p>
              <OwnerControl ticketId={ticket.id} ownerUserId={ticket.ownerUserId} />
            </div>
            <div>
              <p className="text-muted-foreground">SLA</p>
              <p className="font-medium">{formatDateTime(ticket.slaDueAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">1ª resposta</p>
              <p className="font-medium">{formatDateTime(ticket.firstResponseAt)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-medium">Mensagens e notas internas</h2>
          <MessagesSection ticketId={ticket.id} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-4 text-lg font-medium">Histórico</h2>
          <HistorySection ticketId={ticket.id} />
        </CardContent>
      </Card>
    </div>
  );
}
