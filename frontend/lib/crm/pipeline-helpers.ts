import type { LeadStatus, PipelineStageLead, PipelineStageWithLeads } from "@/types/crm";

function deriveStatus(stage: PipelineStageWithLeads): LeadStatus {
  if (stage.isWon) return "won";
  if (stage.isLost) return "lost";
  return "open";
}

/**
 * Move um lead de um estágio para outro dentro dos dados já em cache do
 * TanStack Query (usado para atualização otimista do Kanban). Retorna um
 * novo array — nunca muta o original.
 */
export function moveLeadBetweenStages(
  stages: PipelineStageWithLeads[],
  leadId: number,
  targetStageId: number,
): PipelineStageWithLeads[] {
  let movedLead: PipelineStageLead | undefined;

  const withoutLead = stages.map((stage) => {
    const remaining = stage.leads.filter((lead) => {
      if (lead.id === leadId) {
        movedLead = lead;
        return false;
      }
      return true;
    });

    return remaining.length === stage.leads.length ? stage : { ...stage, leads: remaining };
  });

  if (!movedLead) {
    return stages;
  }

  const leadToInsert = movedLead;

  return withoutLead.map((stage) => {
    if (stage.id !== targetStageId) {
      return stage;
    }

    const updatedLead: PipelineStageLead = {
      ...leadToInsert,
      pipelineStageId: stage.id,
      status: deriveStatus(stage),
    };

    return { ...stage, leads: [updatedLead, ...stage.leads] };
  });
}
