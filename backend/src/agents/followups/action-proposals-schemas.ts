import { z } from 'zod';

export const followUpIdParamForProposalsSchema = z.object({ followUpId: z.coerce.number().int().positive() });
export const actionProposalIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Agentes v2.8 (correio.md seção 20) — "não pedir tool/handler/
 * permission/policy — esses são conceitos internos do pipeline". Só
 * texto descritivo: título, objetivo, descrição/contexto.
 */
export const createActionProposalSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(2000),
    description: z.string().trim().max(4000).optional(),
  })
  .strict();

export const cancelActionProposalSchema = z
  .object({
    reason: z.string().trim().min(1, 'reason é obrigatório.').max(2000),
  })
  .strict();

export const listActionProposalsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
