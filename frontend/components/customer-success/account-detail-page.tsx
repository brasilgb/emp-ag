"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionGate } from "@/components/auth/permission-gate";
import { AccountForm } from "@/components/customer-success/account-form";
import { ActivityForm } from "@/components/customer-success/activity-form";
import { OpportunityForm } from "@/components/customer-success/opportunity-form";
import { ChurnRiskBadge, CsAccountStatusBadge, OnboardingStatusBadge } from "@/components/customer-success/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { useCSAccount, useUpdateCSAccount } from "@/hooks/customer-success/use-cs-accounts";
import { useCSActivities, useCreateCSActivity } from "@/hooks/customer-success/use-cs-activities";
import { useCSOpportunities, useCreateOpportunity } from "@/hooks/customer-success/use-cs-opportunities";
import { ACTIVITY_TYPE_LABELS, OPPORTUNITY_STATUS_LABELS, OPPORTUNITY_TYPE_LABELS, formatCurrency, formatDateTime } from "@/lib/customer-success/format";
import type { AccountFormValues } from "@/lib/validation/customer-success-schema";
import type { ActivityFormValues } from "@/lib/validation/customer-success-schema";
import type { OpportunityFormValues } from "@/lib/validation/customer-success-schema";
import { toErrorMessage } from "@/services/http";

function ActivitiesSection({ accountId }: { accountId: number }) {
  const activitiesQuery = useCSActivities(accountId);
  const createActivity = useCreateCSActivity(accountId);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function handleCreate(values: ActivityFormValues) {
    try {
      await createActivity.mutateAsync(values);
      toast.success("Atividade registrada.");
      setDialogOpen(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao registrar atividade."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Atividades</h2>
        <PermissionGate permission="cs.activities.create">
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus /> Nova atividade
          </Button>
        </PermissionGate>
      </div>

      {activitiesQuery.isLoading ? (
        <LoadingState label="Carregando atividades..." />
      ) : activitiesQuery.isError || !activitiesQuery.data ? (
        <ErrorState onRetry={() => activitiesQuery.refetch()} />
      ) : activitiesQuery.data.data.length === 0 ? (
        <EmptyState title="Nenhuma atividade registrada" description="Registre onboarding, follow-ups, reuniões etc." />
      ) : (
        <ul className="space-y-2">
          {activitiesQuery.data.data.map((activity) => (
            <li key={activity.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {ACTIVITY_TYPE_LABELS[activity.type]} · {activity.title}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(activity.occurredAt)}</span>
              </div>
              {activity.description ? (
                <p className="mt-1 text-muted-foreground">{activity.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova atividade</DialogTitle>
          </DialogHeader>
          <ActivityForm onSubmit={handleCreate} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OpportunitiesSection({ clientId }: { clientId: number }) {
  const opportunitiesQuery = useCSOpportunities({ client: clientId });
  const createOpportunity = useCreateOpportunity();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function handleCreate(values: OpportunityFormValues) {
    try {
      await createOpportunity.mutateAsync(values);
      toast.success("Oportunidade criada.");
      setDialogOpen(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao criar oportunidade."));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Oportunidades de expansão</h2>
        <PermissionGate permission="cs.opportunities.create">
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus /> Nova oportunidade
          </Button>
        </PermissionGate>
      </div>

      {opportunitiesQuery.isLoading ? (
        <LoadingState label="Carregando oportunidades..." />
      ) : opportunitiesQuery.isError || !opportunitiesQuery.data ? (
        <ErrorState onRetry={() => opportunitiesQuery.refetch()} />
      ) : opportunitiesQuery.data.data.length === 0 ? (
        <EmptyState title="Nenhuma oportunidade registrada" description="Registre upsells, cross-sells e renovações." />
      ) : (
        <ul className="space-y-2">
          {opportunitiesQuery.data.data.map((opportunity) => (
            <li key={opportunity.id} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {OPPORTUNITY_TYPE_LABELS[opportunity.type]} · {opportunity.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {OPPORTUNITY_STATUS_LABELS[opportunity.status]}
                </span>
              </div>
              {opportunity.estimatedValue ? (
                <p className="mt-1 text-muted-foreground">{formatCurrency(opportunity.estimatedValue)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova oportunidade</DialogTitle>
          </DialogHeader>
          <OpportunityForm defaultValues={{ clientId }} onSubmit={handleCreate} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AccountDetailPage({ accountId }: { accountId: number }) {
  const [editing, setEditing] = useState(false);

  const accountQuery = useCSAccount(accountId);
  const updateAccount = useUpdateCSAccount(accountId);

  if (accountQuery.isLoading) return <LoadingState label="Carregando conta..." />;
  if (accountQuery.isError || !accountQuery.data) return <ErrorState onRetry={() => accountQuery.refetch()} />;

  const account = accountQuery.data.data;

  async function handleUpdate(values: AccountFormValues) {
    try {
      await updateAccount.mutateAsync(values);
      toast.success("Conta atualizada com sucesso.");
      setEditing(false);
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao atualizar conta."));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" render={<Link href="/customer-success" />} className="mb-2 -ml-2">
          <ArrowLeft /> Customer Success
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{account.clientName}</h1>
              <CsAccountStatusBadge status={account.status} />
              <ChurnRiskBadge risk={account.churnRisk} />
            </div>
            <p className="text-sm text-muted-foreground">
              {account.ownerName ? `Responsável: ${account.ownerName}` : "Sem responsável"}
            </p>
          </div>

          <PermissionGate permission="cs.update">
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
              <AccountForm
                defaultValues={{
                  status: account.status,
                  healthScore: account.healthScore,
                  onboardingStatus: account.onboardingStatus,
                  churnRisk: account.churnRisk,
                  ownerUserId: account.ownerUserId ?? undefined,
                  nextContactAt: account.nextContactAt ? account.nextContactAt.slice(0, 10) : undefined,
                  satisfactionScore: account.satisfactionScore ?? undefined,
                  notes: account.notes ?? undefined,
                }}
                onSubmit={handleUpdate}
              />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Health score</dt>
                  <dd className="font-medium">{account.healthScore} / 100</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Onboarding</dt>
                  <dd>
                    <OnboardingStatusBadge status={account.onboardingStatus} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Satisfação</dt>
                  <dd className="font-medium">{account.satisfactionScore ?? "--"} / 5</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Último contato</dt>
                  <dd>{formatDateTime(account.lastContactAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Próximo contato</dt>
                  <dd>{formatDateTime(account.nextContactAt)}</dd>
                </div>
                {account.notes ? (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Notas</dt>
                    <dd className="whitespace-pre-wrap">{account.notes}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <ActivitiesSection accountId={account.id} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <OpportunitiesSection clientId={account.clientId} />
        </CardContent>
      </Card>
    </div>
  );
}
