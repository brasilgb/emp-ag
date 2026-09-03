/**
 * Agentes v2.6 (correio.md seções 5/8) — vocabulário fechado de Agent
 * Responsibility. Mesmo estilo de `recovery/types.ts`/`operations/health-types.ts`
 * (arrays `as const` + tipo derivado).
 */
export const RESPONSIBILITY_TYPES = ['monitor', 'review', 'coordinate', 'follow_up'] as const;
export type ResponsibilityType = (typeof RESPONSIBILITY_TYPES)[number];

// Mesmo vocabulário já usado por Goals/Initiatives/Decisions — nunca um
// quarto conjunto de valores de prioridade no projeto.
export const RESPONSIBILITY_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ResponsibilityPriority = (typeof RESPONSIBILITY_PRIORITIES)[number];

export const ESCALATION_POLICIES = ['none', 'agent', 'human', 'agent_then_human'] as const;
export type EscalationPolicy = (typeof ESCALATION_POLICIES)[number];
