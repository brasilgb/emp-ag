"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRightLeft, ExternalLink, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ActivitySection } from "@/components/crm/activity-section";
import { LeadForm } from "@/components/crm/lead-form";
import { LeadStatusBadge } from "@/components/crm/status-badge";
import { StageSelect } from "@/components/crm/stage-select";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCreateLeadActivity, useLeadActivities } from "@/hooks/crm/use-activities";
import { useConvertLead, useLead, useUpdateLead } from "@/hooks/crm/use-leads";
import { usePipeline } from "@/hooks/crm/use-pipeline";
import { useAuth } from "@/lib/auth/use-auth";
import { formatCurrency, formatDateTime, LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS } from "@/lib/crm/format";
import { toLeadInput } from "@/lib/crm/lead-input";
import type { ActivityFormValues, LeadFormValues } from "@/lib/validation/crm-schema";
import { toErrorMessage } from "@/services/http";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function LeadDetailPage({ leadId }: { leadId: number }) {
  const router = useRouter();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const leadQuery = useLead(leadId);
  const pipelineQuery = usePipeline();
  const activitiesQuery = useLeadActivities(leadId);

  const updateLead = useUpdateLead(leadId);
  const convertLead = useConvertLead(leadId);
  const createActivity = useCreateLeadActivity(leadId);

  if (leadQuery.isLoading || pipelineQuery.isLoading) {
    return <LoadingState label="Carregando lead..." />;
  }

  if (leadQuery.isError || !leadQuery.data || pipelineQuery.isError || !pipelineQuery.data) {
    return <ErrorState onRetry={() => { leadQuery.refetch(); pipelineQuery.refetch(); }} />;
  }

  const lead = leadQuery.data.data;
  const stages = pipelineQuery.data.stages;
  const currentStage = stages.find((stage) => stage.id === lead.pipelineStageId);
  const alreadyConverted = Boolean(lead.convertedClientId);

  async function handleStageChange(stageId: number) {
    try {
      await updateLead.mutateAsync({ pipelineStageId: stageId });
      toast.success("Estágio atualizado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao alterar o estágio."));
    }
  }

  async function handleUpdate(values: LeadFormValues) {
    try {
      await updateLead.mutateAsync(toLeadInput(values));
      toast.success("Lead atualizado com sucesso.");
      setEditing(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar lead."));
    }
  }

  async function handleConvert() {
    try {
      const { data } = await convertLead.mutateAsync();
      toast.success(`Lead convertido em cliente: ${data.client.name}`);
      setConvertOpen(false);
      router.push(`/clients/${data.client.id}`);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao converter lead."));
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
        <Button variant="ghost" size="sm" render={<Link href="/leads" />} className="mb-2 -ml-2">
          <ArrowLeft /> Leads
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
              <LeadStatusBadge status={lead.status} label={LEAD_STATUS_LABELS[lead.status]} />
            </div>
            <p className="text-sm text-muted-foreground">{lead.companyName ?? "Sem empresa associada"}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <PermissionGate permission="leads.update">
              <Button variant="outline" onClick={() => setEditing((value) => !value)}>
                <Pencil /> {editing ? "Cancelar" : "Editar"}
              </Button>
            </PermissionGate>
            {alreadyConverted ? (
              <Button variant="outline" render={<Link href={`/clients/${lead.convertedClientId}`} />}>
                <ExternalLink /> Ver cliente
              </Button>
            ) : (
              <PermissionGate permission="leads.convert">
                <Button onClick={() => setConvertOpen(true)}>
                  <ArrowRightLeft /> Converter em Cliente
                </Button>
              </PermissionGate>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Informações</CardTitle>
            </CardHeader>
            <CardContent>
              {editing ? (
                <LeadForm
                  defaultValues={{
                    name: lead.name,
                    companyName: lead.companyName ?? undefined,
                    email: lead.email ?? undefined,
                    phone: lead.phone ?? undefined,
                    source: lead.source,
                    estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : undefined,
                    probability: lead.probability,
                    nextActionAt: lead.nextActionAt ? lead.nextActionAt.slice(0, 16) : undefined,
                    nextActionDescription: lead.nextActionDescription ?? undefined,
                    notes: lead.notes ?? undefined,
                  }}
                  onSubmit={handleUpdate}
                  submitLabel="Salvar alterações"
                />
              ) : (
                <div className="divide-y">
                  <InfoRow label="E-mail" value={lead.email ?? "--"} />
                  <InfoRow label="Telefone" value={lead.phone ?? "--"} />
                  <InfoRow label="Origem" value={LEAD_SOURCE_LABELS[lead.source]} />
                  <InfoRow label="Valor estimado" value={formatCurrency(lead.estimatedValue)} />
                  <InfoRow label="Probabilidade" value={`${lead.probability}%`} />
                  <InfoRow label="Responsável" value={lead.ownerName ?? "Sem responsável"} />
                  <InfoRow
                    label="Próxima ação"
                    value={
                      lead.nextActionAt
                        ? `${formatDateTime(lead.nextActionAt)}${lead.nextActionDescription ? ` — ${lead.nextActionDescription}` : ""}`
                        : "--"
                    }
                  />
                  <InfoRow label="Notas" value={lead.notes ?? "--"} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivitySection
                activities={activitiesQuery.data?.data}
                isLoading={activitiesQuery.isLoading}
                isError={activitiesQuery.isError}
                onRetry={() => activitiesQuery.refetch()}
                onCreate={handleCreateActivity}
                isCreating={createActivity.isPending}
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label>Estágio atual</Label>
              {alreadyConverted ? (
                <p className="text-sm font-medium">{currentStage?.name ?? lead.stageName}</p>
              ) : (
                <StageSelect
                  stages={stages}
                  value={lead.pipelineStageId}
                  onChange={handleStageChange}
                  disabled={updateLead.isPending || !can("leads.update")}
                />
              )}
              <p className="text-xs text-muted-foreground">
                {currentStage?.isWon
                  ? "Estágio de ganho"
                  : currentStage?.isLost
                    ? "Estágio de perda"
                    : "Em andamento"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {alreadyConverted ? null : (
        <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Converter lead em cliente?</DialogTitle>
              <DialogDescription>
                Isso cria um cliente{lead.email || lead.phone ? " e um contato principal" : ""} a partir dos
                dados deste lead e move-o para o estágio de ganho. Essa ação não pode ser desfeita.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConvertOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleConvert} disabled={convertLead.isPending}>
                {convertLead.isPending ? "Convertendo..." : "Confirmar conversão"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
