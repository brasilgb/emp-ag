import { z } from 'zod';

/*
 * Validação de entrada do módulo Customer Success. O backend nunca confia
 * apenas na validação do frontend — todo payload passa por aqui antes de
 * tocar o banco. Arquivo independente dos demais módulos, de propósito.
 */

export const csAccountStatusSchema = z.enum([
  'onboarding',
  'active',
  'attention',
  'at_risk',
  'inactive',
]);

export const onboardingStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'completed',
  'blocked',
]);

export const churnRiskSchema = z.enum(['low', 'medium', 'high']);

export const opportunityTypeSchema = z.enum(['upsell', 'cross_sell', 'renewal']);
export const opportunityStatusSchema = z.enum([
  'identified',
  'qualified',
  'proposed',
  'won',
  'lost',
]);

export const activityTypeSchema = z.enum([
  'onboarding',
  'follow_up',
  'meeting',
  'training',
  'satisfaction',
  'renewal',
  'upsell',
  'cross_sell',
  'risk',
  'note',
]);

const idSchema = z.coerce
  .number({ error: 'ID inválido.' })
  .int('ID inválido.')
  .positive('ID inválido.');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Aceita number ou string, sempre armazenado como string com 2 casas
// decimais — nunca float. Opcional, mas exige valor > 0 quando informado.
export const optionalMonetaryValueSchema = z
  .union([z.number(), z.string()])
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
    error: 'Valor estimado deve ser maior que zero.',
  })
  .transform((value) => Number(value).toFixed(2))
  .optional();

/*
 * Contas CS
 */

export const createCsAccountSchema = z.object({
  clientId: idSchema,
});

export const updateCsAccountSchema = z.object({
  ownerUserId: idSchema.optional(),
  status: csAccountStatusSchema.optional(),
  healthScore: z.number().int().min(0, 'Entre 0 e 100.').max(100, 'Entre 0 e 100.').optional(),
  onboardingStatus: onboardingStatusSchema.optional(),
  lastContactAt: z.iso.datetime({ offset: true }).optional(),
  nextContactAt: z.iso.datetime({ offset: true }).optional(),
  satisfactionScore: z
    .union([z.number().int().min(1, 'Entre 1 e 5.').max(5, 'Entre 1 e 5.'), z.null()])
    .optional(),
  churnRisk: churnRiskSchema.optional(),
  notes: z.string().trim().max(10000).optional(),
});

export const listAccountsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: csAccountStatusSchema.optional(),
  churnRisk: churnRiskSchema.optional(),
  owner: idSchema.optional(),
});

export const accountIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Atividades
 */

export const createActivitySchema = z.object({
  type: activityTypeSchema,
  title: z.string().trim().min(1, 'Título é obrigatório.').max(200),
  description: z.string().trim().max(10000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export const listActivitiesQuerySchema = paginationQuerySchema;

/*
 * Oportunidades
 */

export const createOpportunitySchema = z.object({
  clientId: idSchema,
  type: opportunityTypeSchema,
  title: z.string().trim().min(1, 'Título é obrigatório.').max(200),
  description: z.string().trim().max(10000).optional(),
  estimatedValue: optionalMonetaryValueSchema,
  ownerUserId: idSchema.optional(),
});

export const updateOpportunitySchema = z.object({
  type: opportunityTypeSchema.optional(),
  title: z.string().trim().min(1, 'Título é obrigatório.').max(200).optional(),
  description: z.string().trim().max(10000).optional(),
  estimatedValue: optionalMonetaryValueSchema,
  status: opportunityStatusSchema.optional(),
  ownerUserId: idSchema.optional(),
});

export const listOpportunitiesQuerySchema = paginationQuerySchema.extend({
  status: opportunityStatusSchema.optional(),
  type: opportunityTypeSchema.optional(),
  client: idSchema.optional(),
  owner: idSchema.optional(),
});

export const opportunityIdParamSchema = z.object({
  id: idSchema,
});
