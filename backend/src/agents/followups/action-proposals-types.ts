/**
 * Agentes v2.8 (correio.md seção 5) — vocabulário fechado de Operational
 * Action Proposal. Modelo simplificado (sem `draft`, avaliado e
 * descartado — não existe edição progressiva antes da submissão).
 */
export const ACTION_PROPOSAL_STATUSES = ['submitted', 'planned', 'completed', 'failed', 'cancelled'] as const;
export type ActionProposalStatus = (typeof ACTION_PROPOSAL_STATUSES)[number];

// `submitted` é o estado de criação (nenhum efeito colateral ainda).
// `planned` só é alcançado via o endpoint /submit, que de fato invoca o
// pipeline oficial — `completed`/`failed` chegam por meio do próprio
// resultado do Action Plan (nunca uma ação humana direta).
//
// Fechamento v2.8 ("ponto de consistência 2") — `cancelled` só é
// alcançável a partir de `submitted`. Depois que uma proposta é
// efetivamente planejada (`planned`, com um Action Plan real vinculado),
// a governança sobre o que acontece com ela passa a pertencer
// integralmente ao Action Plan/Approval já existentes (rejeitar o item
// via `POST /agents/approvals/:id/reject`, por exemplo) — nunca mais a
// um "cancelamento" da proposta em si, que criaria um caminho paralelo
// de controle sobre uma entidade que o pipeline oficial já governa.
export const ACTION_PROPOSAL_TRANSITIONS: Record<ActionProposalStatus, readonly ActionProposalStatus[]> = {
  submitted: ['planned', 'cancelled'],
  planned: ['completed', 'failed'],
  completed: [],
  failed: [],
  cancelled: [],
};
