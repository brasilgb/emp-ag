import { z } from 'zod';

import { FOLLOW_UP_PRIORITIES, FOLLOW_UP_STATUSES } from './types.js';

export const followUpIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Agentes v2.7 (correio.md seção 6.B) — criação gerencial direta,
 * associada a uma Responsibility real. Nunca um campo livre que resulte
 * em execução (mesmo princípio de `responsibilities/schemas.ts`) — todo
 * vocabulário fechado é `z.enum`, `title`/`description` são só texto
 * descritivo persistido, nunca interpretado como comando.
 */
export const createManualFollowUpSchema = z
  .object({
    responsibilityId: z.number().int().positive(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    priority: z.enum(FOLLOW_UP_PRIORITIES).default('medium'),
    assignedUserId: z.number().int().positive().optional(),
    dueAt: z.coerce.date().optional(),
    nextReviewAt: z.coerce.date().optional(),
  })
  .strict();

export const waitFollowUpSchema = z
  .object({
    waitingReason: z.string().trim().min(1, 'waitingReason é obrigatório.').max(2000),
    waitingUntil: z.coerce.date().optional(),
  })
  .strict();

export const completeFollowUpSchema = z
  .object({
    resolution: z.string().trim().min(1, 'resolution é obrigatório.').max(4000),
  })
  .strict();

export const dismissFollowUpSchema = z
  .object({
    reason: z.string().trim().min(1, 'reason é obrigatório.').max(2000),
  })
  .strict();

export const reassignFollowUpSchema = z
  .object({
    assignedUserId: z.number().int().positive().nullable(),
  })
  .strict();

export const listFollowUpsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(FOLLOW_UP_STATUSES).optional(),
  priority: z.enum(FOLLOW_UP_PRIORITIES).optional(),
  ownerAgentId: z.coerce.number().int().positive().optional(),
  assignedUserId: z.coerce.number().int().positive().optional(),
  responsibilityId: z.coerce.number().int().positive().optional(),
  escalationId: z.coerce.number().int().positive().optional(),
  overdue: z.enum(['true', 'false']).optional(),
});
