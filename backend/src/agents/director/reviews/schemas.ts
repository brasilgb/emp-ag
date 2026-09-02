import { z } from 'zod';

import { RECOMMENDATION_TYPES, REVIEW_OUTCOMES } from './types.js';

/**
 * Agentes v2.2 (correio.md seção 7) — contrato estrutural da saída do
 * Executive Reviewer. `.strict()` em cada objeto, mesmo mecanismo já
 * usado em `planner/schemas.ts`/`agents/llm/schema.ts`: qualquer campo
 * fora desta lista (sql, action, tool, approve, execute...) é rejeitado
 * pelo Zod antes de qualquer outra validação — nunca por uma checagem de
 * blocklist à parte. É a garantia estrutural de "o LLM não decide
 * autorização" (seção 8): a saída simplesmente NÃO TEM CAMPO nenhum que
 * autorizaria/executaria algo.
 */
export const executiveReviewRecommendationSchema = z
  .object({
    type: z.enum(RECOMMENDATION_TYPES),
    reason: z.string().trim().min(1).max(2000),
    proposedGoal: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const executiveReviewOutputSchema = z
  .object({
    outcome: z.enum(REVIEW_OUTCOMES),
    summary: z.string().trim().min(1).max(1000),
    assessment: z.string().trim().min(1).max(4000),
    confidence: z.number().min(0).max(1),
    recommendation: executiveReviewRecommendationSchema,
  })
  .strict();

export type ExecutiveReviewOutput = z.infer<typeof executiveReviewOutputSchema>;
export type ExecutiveReviewRecommendation = z.infer<typeof executiveReviewRecommendationSchema>;
