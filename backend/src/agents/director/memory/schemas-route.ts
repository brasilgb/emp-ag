import { z } from 'zod';

import { MEMORY_STATUSES, MEMORY_TYPES } from './types.js';

// Mesmo shape de param (inteiro positivo) usado em toda a API de
// Agentes (initiativeIdParamSchema, goalIdParamSchema...).
export const memoryIdParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const reviewIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const domainSchema = z.enum(['crm', 'projects', 'finance', 'support', 'agents']);

export const listStrategicMemoriesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  domain: domainSchema.optional(),
  memoryType: z.enum(MEMORY_TYPES).optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
  goalId: z.coerce.number().int().positive().optional(),
  initiativeId: z.coerce.number().int().positive().optional(),
});
