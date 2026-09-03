/**
 * Agentes v2.7 (correio.md seções 3/4) — vocabulário fechado de
 * Operational FollowUp. Mesmo estilo de `responsibilities/types.ts`/
 * `escalations/types.ts` (arrays `as const` + tipo derivado).
 */
export const FOLLOW_UP_STATUSES = ['open', 'in_progress', 'waiting', 'completed', 'dismissed'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

// Máquina de estados exatamente como sugerida na seção 4 — `completed`/
// `dismissed` terminais para ações humanas normais (nunca aceitam PATCH
// genérico de status, seção 4/17: "não expor endpoint que permita
// alterar livremente status").
export const FOLLOW_UP_TRANSITIONS: Record<FollowUpStatus, readonly FollowUpStatus[]> = {
  open: ['in_progress', 'waiting', 'completed', 'dismissed'],
  in_progress: ['waiting', 'completed', 'dismissed'],
  waiting: ['in_progress', 'completed', 'dismissed'],
  completed: [],
  dismissed: [],
};

// Mesmo vocabulário já usado por Responsibilities/Goals/Initiatives/
// Decisions — nunca um quinto conjunto de valores de prioridade.
export const FOLLOW_UP_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type FollowUpPriority = (typeof FOLLOW_UP_PRIORITIES)[number];

export const FOLLOW_UP_SOURCE_TYPES = ['escalation', 'responsibility'] as const;
export type FollowUpSourceType = (typeof FOLLOW_UP_SOURCE_TYPES)[number];
