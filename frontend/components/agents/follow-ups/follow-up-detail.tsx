"use client";

import { useAgents } from "@/hooks/agents/use-agents";
import { useFollowUp } from "@/hooks/agents/use-follow-ups";
import { useUsersDirectory } from "@/hooks/use-users-directory";
import { followUpPriorityLabel, followUpSourceTypeLabel } from "@/lib/agents/derived";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";

import { FollowUpStatusBadge } from "../status-badge";
import { ActionProposalsList } from "./action-proposals-list";

/**
 * Agentes v2.8 (correio.md seção 19) — dentro de `/agents/follow-ups`,
 * o usuário consegue distinguir claramente FollowUp de Action Proposal
 * de Action Plan. Esta página mostra o FollowUp (contexto de
 * acompanhamento) e, abaixo, a lista de propostas de ação associadas.
 */
export function FollowUpDetail({ followUpId }: { followUpId: number }) {
  const followUpQuery = useFollowUp(followUpId);
  const agentsQuery = useAgents();
  const usersQuery = useUsersDirectory();

  if (followUpQuery.isLoading) return <LoadingState label="Carregando FollowUp..." />;
  if (followUpQuery.isError || !followUpQuery.data) return <ErrorState onRetry={() => followUpQuery.refetch()} />;

  const followUp = followUpQuery.data.data;
  const ownerName = agentsQuery.data?.data.find((agent) => agent.id === followUp.ownerAgentId)?.name ?? `Agente #${followUp.ownerAgentId}`;
  const assignedName = followUp.assignedUserId
    ? (usersQuery.data?.data.find((user) => user.id === followUp.assignedUserId)?.name ?? `Usuário #${followUp.assignedUserId}`)
    : "--";

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
        </CardContent>
      </Card>

      <ActionProposalsList followUpId={followUp.id} followUpStatus={followUp.status} />
    </div>
  );
}
