"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { KanbanCard } from "@/components/crm/kanban-card";
import { ErrorState } from "@/components/states/error-state";
import { LoadingState } from "@/components/states/loading-state";
import { usePipeline } from "@/hooks/crm/use-pipeline";
import { queryKeys } from "@/lib/query/keys";
import { moveLeadBetweenStages } from "@/lib/crm/pipeline-helpers";
import { updateLead } from "@/services/leads";
import { toErrorMessage } from "@/services/http";
import type { PipelineStageWithLeads } from "@/types/crm";

type PipelineData = { stages: PipelineStageWithLeads[] };

/**
 * Kanban do funil comercial. Em vez de arrastar-e-soltar (opcional — ver
 * item 25 do briefing), a mudança de estágio acontece pelo seletor no
 * próprio card. O comportamento exigido é o mesmo: chama o backend, trata
 * erro e restaura a posição visual em caso de rejeição — feito aqui via
 * atualização otimista do cache do TanStack Query com rollback em onError.
 */
export function KanbanBoard() {
  const { data, isLoading, isError, refetch } = usePipeline();
  const queryClient = useQueryClient();

  const moveMutation = useMutation({
    mutationFn: ({ leadId, stageId }: { leadId: number; stageId: number }) =>
      updateLead(leadId, { pipelineStageId: stageId }),

    onMutate: async ({ leadId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.crm.pipeline });

      const previous = queryClient.getQueryData<PipelineData>(queryKeys.crm.pipeline);

      if (previous) {
        queryClient.setQueryData<PipelineData>(queryKeys.crm.pipeline, {
          stages: moveLeadBetweenStages(previous.stages, leadId, stageId),
        });
      }

      return { previous };
    },

    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.crm.pipeline, context.previous);
      }

      toast.error(toErrorMessage(error, "Erro ao mover o lead. A posição anterior foi restaurada."));
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.crm.pipeline });
      queryClient.invalidateQueries({ queryKey: ["crm", "leads"] });
    },
  });

  if (isLoading) {
    return <LoadingState label="Carregando pipeline..." />;
  }

  if (isError || !data) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  const stageOptions = data.stages.map((stage) => ({ id: stage.id, name: stage.name }));

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {data.stages.map((stage) => (
        <div key={stage.id} className="flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-medium">{stage.name}</span>
            <Badge variant="secondary">{stage.leads.length}</Badge>
          </div>

          <div className="flex-1 space-y-2 p-2">
            {stage.leads.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">Nenhum lead</p>
            ) : (
              stage.leads.map((lead) => (
                <KanbanCard
                  key={lead.id}
                  lead={lead}
                  stages={stageOptions}
                  isMoving={moveMutation.isPending && moveMutation.variables?.leadId === lead.id}
                  onMoveStage={(stageId) => moveMutation.mutate({ leadId: lead.id, stageId })}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
