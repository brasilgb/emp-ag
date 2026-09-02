/**
 * Agentes v2.2 (correio.md seções 3/4/9) — vocabulário fechado da
 * Executive Review. Espelha o estilo de `goals/types.ts`/`decisions/types.ts`
 * (arrays `as const` + tipo derivado), única fonte de verdade reaproveitada
 * por schema Zod, rota e frontend.
 */
export const REVIEW_STATUSES = ['draft', 'completed', 'superseded'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_OUTCOMES = ['successful', 'partially_successful', 'unsuccessful', 'inconclusive', 'blocked'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const RECOMMENDATION_TYPES = ['none', 'continue', 'adjust', 'new_initiative', 'escalate'] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

// Correio.md seção 13: só estados TERMINAIS da execução real (derivada em
// `initiatives-progress.ts`) são elegíveis para revisão — nunca `running`,
// `waiting_approval` ou `not_started` (seção 14: "impedir revisão
// prematura quando não houver evidência suficiente"). `failed` também é
// elegível: uma execução que falhou tecnicamente ainda é um resultado
// real e revisável (o Diretor pode classificar como `unsuccessful` ou
// `blocked`, conforme a evidência).
export const REVIEWABLE_EXECUTION_STATES = ['completed', 'blocked', 'failed'] as const;
