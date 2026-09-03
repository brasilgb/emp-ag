import { z } from 'zod';

import { ESCALATION_STATUSES } from './types.js';

export const escalationIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const dismissEscalationSchema = z.object({ reason: z.string().trim().min(1, 'reason é obrigatório.').max(2000) }).strict();

export const listEscalationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(ESCALATION_STATUSES).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  responsibilityId: z.coerce.number().int().positive().optional(),
  targetAgentId: z.coerce.number().int().positive().optional(),
  targetUserId: z.coerce.number().int().positive().optional(),
});
