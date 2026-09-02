import { z } from 'zod';

import { GOAL_HEALTHS, GOAL_STATUSES, GOAL_TARGET_TYPES, INITIATIVE_STATUSES, METRIC_DIRECTIONS } from './types.js';

const domainSchema = z.enum(['crm', 'projects', 'finance', 'support', 'agents']);
const prioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const goalIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const createGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1),
    domain: domainSchema,
    priority: prioritySchema.default('medium'),
    ownerUserId: z.number().int().positive().optional(),
    startDate: z.coerce.date(),
    targetDate: z.coerce.date(),
    targetType: z.enum(GOAL_TARGET_TYPES).default('metric'),
    targetValue: z.number().finite().optional(),
    unit: z.string().trim().max(30).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .refine((data) => data.targetDate.getTime() > data.startDate.getTime(), {
    message: 'targetDate deve ser posterior a startDate.',
    path: ['targetDate'],
  });

export const updateGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().min(1).optional(),
    priority: prioritySchema.optional(),
    ownerUserId: z.number().int().positive().nullable().optional(),
    targetDate: z.coerce.date().optional(),
    targetValue: z.number().finite().nullable().optional(),
    currentValue: z.number().finite().nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
  })
  .strict();

export const cancelGoalSchema = z.object({ reason: z.string().trim().min(1, 'reason é obrigatório.').max(2000) }).strict();

export const listGoalsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(GOAL_STATUSES).optional(),
  domain: domainSchema.optional(),
  health: z.enum(GOAL_HEALTHS).optional(),
  ownerUserId: z.coerce.number().int().positive().optional(),
});

export const addGoalMetricSchema = z
  .object({
    metricKey: z.string().trim().min(1),
    targetValue: z.number().finite(),
    weight: z.number().int().positive().max(100).default(1),
    direction: z.enum(METRIC_DIRECTIONS).optional(),
  })
  .strict();

// --- Initiatives ---

export const initiativeIdParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const goalIdRouteParamSchema = z.object({ goalId: z.coerce.number().int().positive() });

export const createInitiativeSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1),
    domain: domainSchema,
    priority: prioritySchema.default('medium'),
    rationale: z.string().trim().min(1),
    expectedImpact: z.string().trim().max(2000).optional(),
    ownerUserId: z.number().int().positive().optional(),
    targetDate: z.coerce.date().optional(),
  })
  .strict();

export const updateInitiativeSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().min(1).optional(),
    priority: prioritySchema.optional(),
    ownerUserId: z.number().int().positive().nullable().optional(),
    targetDate: z.coerce.date().nullable().optional(),
  })
  .strict();

export const cancelInitiativeSchema = z.object({ reason: z.string().trim().min(1, 'reason é obrigatório.').max(2000) }).strict();

export const listInitiativesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  goalId: z.coerce.number().int().positive().optional(),
  status: z.enum(INITIATIVE_STATUSES).optional(),
});
