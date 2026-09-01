import { z } from 'zod';

import { EVENT_TYPES, isEventType } from './catalog.js';
import { filtersSchema, validateFiltersAgainstEventType } from './filters.js';

/*
 * Agentes v1.4 — validação de entrada de routes/agents/{events,event-rules}.ts.
 * Mesmo racional de schemas/agents.ts: o backend nunca confia apenas na
 * validação do frontend.
 */

const idSchema = z.coerce.number({ error: 'ID inválido.' }).int('ID inválido.').positive('ID inválido.');

export const eventIdParamSchema = z.object({ id: idSchema });
export const eventRuleIdParamSchema = z.object({ id: idSchema });

export const listEventsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'processing', 'processed', 'failed', 'ignored']).optional(),
  eventType: z.string().trim().min(1).optional(),
});

// event_type validado contra o catálogo aqui (nunca aceito solto) — o
// mesmo texto de erro serve pra criação e edição de Event Rule.
const eventTypeSchema = z.string().refine(isEventType, {
  message: `event_type deve ser um dos tipos do catálogo: ${EVENT_TYPES.join(', ')}.`,
});

export const createEventRuleSchema = z
  .object({
    name: z.string().trim().min(1, 'name é obrigatório.').max(150),
    description: z.string().trim().max(2000).optional(),
    eventType: eventTypeSchema,
    eventVersion: z.number().int().positive().default(1),
    jobId: idSchema,
    filters: filtersSchema.default({}),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    for (const error of validateFiltersAgainstEventType(data.eventType, data.filters)) {
      ctx.addIssue({ code: 'custom', message: error.message, path: ['filters', error.field] });
    }
  });

export const updateEventRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(2000).optional(),
    filters: filtersSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const listEventRulesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  eventType: z.string().trim().min(1).optional(),
  jobId: idSchema.optional(),
  enabled: z.coerce.boolean().optional(),
});
