"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Pencil, Plus, Star } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ActivitySection } from "@/components/crm/activity-section";
import { ClientForm } from "@/components/crm/client-form";
import { ClientStatusBadge } from "@/components/crm/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import {
  useClient,
  useClientContacts,
  useCreateClientContact,
  useUpdateClient,
} from "@/hooks/crm/use-clients";
import { useClientActivities, useCreateClientActivity } from "@/hooks/crm/use-activities";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS } from "@/lib/crm/format";
import {
  contactFormSchema,
  type ActivityFormValues,
  type ClientFormValues,
  type ContactFormInput,
  type ContactFormValues,
} from "@/lib/validation/crm-schema";
import { toErrorMessage } from "@/services/http";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ContactForm({ onSubmit }: { onSubmit: (values: ContactFormValues) => Promise<void> }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormInput, unknown, ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { name: "", isPrimary: false },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="contact-name">Nome</Label>
        <Input id="contact-name" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">E-mail</Label>
          <Input id="contact-email" type="email" {...register("email")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-phone">Telefone</Label>
          <Input id="contact-phone" {...register("phone")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-position">Cargo</Label>
        <Input id="contact-position" {...register("position")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-notes">Observações</Label>
        <Textarea id="contact-notes" rows={2} {...register("notes")} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" {...register("isPrimary")} />
        Contato principal
      </label>
      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Salvando..." : "Adicionar contato"}
      </Button>
    </form>
  );
}

export function ClientDetailPage({ clientId }: { clientId: number }) {
  const [editing, setEditing] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);

  const clientQuery = useClient(clientId);
  const contactsQuery = useClientContacts(clientId);
  const activitiesQuery = useClientActivities(clientId);

  const updateClient = useUpdateClient(clientId);
  const createContact = useCreateClientContact(clientId);
  const createActivity = useCreateClientActivity(clientId);

  if (clientQuery.isLoading) {
    return <LoadingState label="Carregando cliente..." />;
  }

  if (clientQuery.isError || !clientQuery.data) {
    return <ErrorState onRetry={() => clientQuery.refetch()} />;
  }

  const client = clientQuery.data.data;

  async function handleUpdate(values: ClientFormValues) {
    try {
      await updateClient.mutateAsync(values);
      toast.success("Cliente atualizado com sucesso.");
      setEditing(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar cliente."));
    }
  }

  async function handleCreateContact(values: ContactFormValues) {
    try {
      await createContact.mutateAsync(values);
      toast.success("Contato adicionado.");
      setContactDialogOpen(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao adicionar contato."));
    }
  }

  async function handleCreateActivity(values: ActivityFormValues) {
    try {
      await createActivity.mutateAsync(values);
      toast.success("Atividade registrada.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao registrar atividade."));
      throw error;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/clients" />} className="mb-2 -ml-2">
          <ArrowLeft /> Clientes
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
              <ClientStatusBadge status={client.status} label={CLIENT_STATUS_LABELS[client.status]} />
            </div>
            <p className="text-sm text-muted-foreground">{CLIENT_TYPE_LABELS[client.type]}</p>
          </div>
          <PermissionGate permission="clients.update">
            <Button variant="outline" onClick={() => setEditing((value) => !value)}>
              <Pencil /> {editing ? "Cancelar edição" : "Editar"}
            </Button>
          </PermissionGate>
        </div>
      </div>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="contatos">Contatos</TabsTrigger>
          <TabsTrigger value="atividades">Atividades</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          <Card className="max-w-2xl">
            <CardContent className="pt-6">
              {editing ? (
                <ClientForm
                  defaultValues={{
                    type: client.type,
                    name: client.name,
                    legalName: client.legalName ?? undefined,
                    document: client.document ?? undefined,
                    email: client.email ?? undefined,
                    phone: client.phone ?? undefined,
                    website: client.website ?? undefined,
                    status: client.status,
                    notes: client.notes ?? undefined,
                  }}
                  onSubmit={handleUpdate}
                  submitLabel="Salvar alterações"
                />
              ) : (
                <div className="divide-y">
                  <InfoRow label="Nome" value={client.name} />
                  <InfoRow label="Razão social" value={client.legalName ?? "--"} />
                  <InfoRow label="Documento" value={client.document ?? "--"} />
                  <InfoRow label="E-mail" value={client.email ?? "--"} />
                  <InfoRow label="Telefone" value={client.phone ?? "--"} />
                  <InfoRow label="Website" value={client.website ?? "--"} />
                  <InfoRow label="Observações" value={client.notes ?? "--"} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="contatos" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <PermissionGate permission="contacts.create">
              <Button size="sm" onClick={() => setContactDialogOpen(true)}>
                <Plus /> Novo contato
              </Button>
            </PermissionGate>
          </div>

          {contactsQuery.isLoading ? (
            <LoadingState label="Carregando contatos..." />
          ) : contactsQuery.isError ? (
            <ErrorState onRetry={() => contactsQuery.refetch()} />
          ) : !contactsQuery.data || contactsQuery.data.data.length === 0 ? (
            <EmptyState title="Nenhum contato cadastrado" description="Adicione o primeiro contato deste cliente." />
          ) : (
            <div className="space-y-3">
              {contactsQuery.data.data.map((contact) => (
                <Card key={contact.id}>
                  <CardContent className="flex items-start justify-between gap-4 pt-6">
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {contact.name}
                        {contact.isPrimary ? <Star className="size-3.5 fill-current text-amber-500" /> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">{contact.position ?? "--"}</p>
                      <p className="text-sm text-muted-foreground">
                        {contact.email ?? "--"} · {contact.phone ?? "--"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="atividades" className="mt-4">
          <ActivitySection
            activities={activitiesQuery.data?.data}
            isLoading={activitiesQuery.isLoading}
            isError={activitiesQuery.isError}
            onRetry={() => activitiesQuery.refetch()}
            onCreate={handleCreateActivity}
            isCreating={createActivity.isPending}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo contato</DialogTitle>
          </DialogHeader>
          <ContactForm onSubmit={handleCreateContact} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
