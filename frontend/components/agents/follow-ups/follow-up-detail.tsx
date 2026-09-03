"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAgents } from "@/hooks/agents/use-agents";
import { useFollowUp, useResumeFollowUp, useStartFollowUp } from "@/hooks/agents/use-follow-ups";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { followUpPriorityLabel, followUpSourceTypeLabel } from "@/lib/agents/derived";
import { toErrorMessage } from "@/services/http";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";

import { FollowUpStatusBadge } from "../status-badge";
import { ActionProposalsList } from "./action-proposals-list";
import { CompleteFollowUpDialog } from "./complete-follow-up-dialog";
import { DismissFollowUpDialog } from "./dismiss-follow-up-dialog";
import { FollowUpTimeline } from "./follow-up-timeline";
import { WaitFollowUpDialog } from "./wait-follow-up-dialog";

/**
 * Agentes v2.8 (correio.md seção 19) — dentro de `/agents/follow-ups`,
 * o usuário consegue distinguir claramente FollowUp de Action Proposal
 * de Action Plan. Esta página mostra o FollowUp (contexto de
 * acompanhamento) e, abaixo, a lista de propostas de ação associadas.
 *
 * v2.9 (correio.md "BLOQUEIO 2") — a partir da evidência mostrada por
 * `ActionProposalsList` (execução real do Action Plan), o operador
 * precisa conseguir agir sobre o PRÓPRIO FollowUp sem sair desta página.
 * Reutiliza EXATAMENTE os mesmos hooks/diálogos já usados em
 * `follow-ups-list.tsx` (start/wait/resume/complete/dismiss, máquina de
 * estados da v2.7, `FOLLOW_UP_TRANSITIONS`) — nenhuma ação nova, nenhum
 * mecanismo paralelo. `complete`/`dismiss` sempre exigem
 * `resolution`/`reason` textual (os diálogos já fazem isso) — a
 * conclusão do FollowUp continua sendo uma decisão humana explícita,
 * nunca inferida automaticamente do resultado do Action Plan.
 */
export function FollowUpDetail({ followUpId }: { followUpId: number }) {
  const followUpQuery = useFollowUp(followUpId);
  const agentsQuery = useAgents();
  const usersQuery = useUsersDirectory();
  const start = useStartFollowUp();
  const resume = useResumeFollowUp();
  const [waitOpen, setWaitOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);

  if (followUpQuery.isLoading) return <LoadingState label="Carregando FollowUp..." />;
  if (followUpQuery.isError || !followUpQuery.data) return <ErrorState onRetry={() => followUpQuery.refetch()} />;

  const followUp = followUpQuery.data.data;
  const ownerName = agentsQuery.data?.data.find((agent) => agent.id === followUp.ownerAgentId)?.name ?? `Agente #${followUp.ownerAgentId}`;
  const assignedName = followUp.assignedUserId
    ? (usersQuery.data?.data.find((user) => user.id === followUp.assignedUserId)?.name ?? `Usuário #${followUp.assignedUserId}`)
    : "--";
  const isTerminal = followUp.status === "completed" || followUp.status === "dismissed";

  async function handleStart() {
    try {
      await start.mutateAsync(followUpId);
      toast.success("FollowUp iniciado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao iniciar."));
    }
  }

  async function handleResume() {
    try {
      await resume.mutateAsync(followUpId);
      toast.success("FollowUp retomado.");
    } catch (error) {
      toast.error(toErrorMessage(error, "Erro ao retomar."));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{followUp.title}</h2>
              {followUp.description ? <p className="text-sm text-muted-foreground">{followUp.description}</p> : null}
            </div>
            <FollowUpStatusBadge status={followUp.status} />
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
            <div>
              <p className="font-medium text-foreground">Owner</p>
              <p>{ownerName}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Atribuído</p>
              <p>{assignedName}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Prioridade</p>
              <p>{followUpPriorityLabel(followUp.priority)}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Origem</p>
              <p>{followUpSourceTypeLabel(followUp.sourceType)}</p>
            </div>
          </div>

          {followUp.resolution ? (
            <div className="rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
              <p className="font-medium">Resolução</p>
              <p>{followUp.resolution}</p>
            </div>
          ) : null}

          {!isTerminal ? (
            <PermissionGate permission="agents.followups.manage">
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {followUp.status === "open" ? (
                  <Button size="sm" variant="outline" disabled={start.isPending} onClick={handleStart}>
                    Iniciar
                  </Button>
                ) : null}
                {followUp.status === "waiting" ? (
                  <Button size="sm" variant="outline" disabled={resume.isPending} onClick={handleResume}>
                    Retomar
                  </Button>
                ) : null}
                {followUp.status === "open" || followUp.status === "in_progress" ? (
                  <Button size="sm" variant="outline" onClick={() => setWaitOpen(true)}>
                    Aguardar
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => setCompleteOpen(true)}>
                  Concluir
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setDismissOpen(true)}>
                  Descartar
                </Button>
              </div>
            </PermissionGate>
          ) : null}
        </CardContent>
      </Card>

      <ActionProposalsList followUpId={followUp.id} followUpStatus={followUp.status} />

      {/* Agentes v3.0 (correio.md "Etapa 3") — timeline operacional
          reunindo tudo que já é mostrado acima (Proposals/Action
          Plans/Approvals) numa ordem cronológica real. */}
      <FollowUpTimeline followUpId={followUp.id} />

      <WaitFollowUpDialog followUpId={followUpId} open={waitOpen} onOpenChange={setWaitOpen} />
      <CompleteFollowUpDialog followUpId={followUpId} open={completeOpen} onOpenChange={setCompleteOpen} />
      <DismissFollowUpDialog followUpId={followUpId} open={dismissOpen} onOpenChange={setDismissOpen} />
    </div>
  );
}
