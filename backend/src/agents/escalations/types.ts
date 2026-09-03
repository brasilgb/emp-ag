/**
 * Agentes v2.6 (correio.md seções 10/11) — vocabulário fechado de
 * Operational Escalation.
 */
export const ESCALATION_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type EscalationSeverity = (typeof ESCALATION_SEVERITIES)[number];

export const ESCALATION_STATUSES = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

// Transições válidas (seção 11: "transitions devem ser validadas no
// backend"). `resolved`/`dismissed` são terminais para AÇÕES PÚBLICAS —
// só reabrem via o mecanismo INTERNO de dedup/reocorrência
// (`service.ts:createOrReopenEscalation`), nunca por uma ação de
// usuário direta.
export const ESCALATION_TRANSITIONS: Record<EscalationStatus, readonly EscalationStatus[]> = {
  open: ['acknowledged', 'resolved', 'dismissed'],
  acknowledged: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};
