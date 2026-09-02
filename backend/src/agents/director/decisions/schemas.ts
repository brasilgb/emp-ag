import { z } from 'zod';

import { DECISION_STATUSES } from './types.js';

const domainSchema = z.enum(['crm', 'projects', 'finance', 'support', 'agents']);
const severitySchema = z.enum(['info', 'attention', 'warning', 'critical']);

export const decisionIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const listDecisionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(DECISION_STATUSES).optional(),
  domain: domainSchema.optional(),
  severity: severitySchema.optional(),
  assignedUserId: z.coerce.number().int().positive().optional(),
  requiresHumanAttention: z.coerce.boolean().optional(),
});

export const assignDecisionSchema = z.object({ userId: z.number().int().positive() }).strict();

export const dismissDecisionSchema = z.object({ reason: z.string().trim().min(1, 'reason é obrigatório.').max(2000) }).strict();
