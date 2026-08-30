import { z } from 'zod';

/*
 * Validação de entrada do módulo CRM. O backend nunca confia apenas na
 * validação do frontend — todo payload passa por aqui antes de tocar o
 * banco.
 */

export const clientTypeSchema = z.enum(['person', 'company']);
export const clientStatusSchema = z.enum(['active', 'inactive']);

export const leadSourceSchema = z.enum([
  'website',
  'google_ads',
  'meta_ads',
  'instagram',
  'facebook',
  'whatsapp',
  'referral',
  'outbound',
  'organic',
  'other',
]);

export const crmActivityTypeSchema = z.enum([
  'note',
  'call',
  'email',
  'meeting',
  'whatsapp',
  'follow_up',
  'status_change',
  'conversion',
  'system',
]);

// Aceita number ou string (o frontend pode enviar "1234.50"), sempre
// armazenado como string com 2 casas decimais na coluna numeric — nunca
// float.
export const monetaryValueSchema = z
  .union([z.number(), z.string()])
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
    error: 'Valor monetário inválido.',
  })
  .transform((value) => Number(value).toFixed(2));

export const probabilitySchema = z
  .number()
  .int('Probabilidade deve ser um número inteiro.')
  .min(0, 'Probabilidade deve ser entre 0 e 100.')
  .max(100, 'Probabilidade deve ser entre 0 e 100.');

const idSchema = z.coerce
  .number({ error: 'ID inválido.' })
  .int('ID inválido.')
  .positive('ID inválido.');

const optionalEmail = z
  .union([z.email('E-mail inválido.'), z.literal('')])
  .optional()
  .transform((value) => (value ? value : undefined));

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/*
 * Clientes
 */

export const createClientSchema = z.object({
  type: clientTypeSchema,
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  legalName: z.string().trim().max(200).optional(),
  document: z.string().trim().max(32).optional(),
  email: optionalEmail,
  phone: z.string().trim().max(32).optional(),
  website: z.string().trim().max(255).optional(),
  status: clientStatusSchema.default('active'),
  notes: z.string().trim().max(5000).optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const listClientsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
  type: clientTypeSchema.optional(),
});

export const clientIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Contatos
 */

export const createContactSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  email: optionalEmail,
  phone: z.string().trim().max(32).optional(),
  position: z.string().trim().max(120).optional(),
  isPrimary: z.boolean().default(false),
  notes: z.string().trim().max(5000).optional(),
});

export const updateContactSchema = createContactSchema.partial();

export const contactIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Leads
 */

export const createLeadSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  companyName: z.string().trim().max(200).optional(),
  email: optionalEmail,
  phone: z.string().trim().max(32).optional(),
  source: leadSourceSchema.default('other'),
  pipelineStageId: idSchema.optional(),
  ownerUserId: idSchema.optional(),
  estimatedValue: monetaryValueSchema.optional(),
  probability: probabilitySchema.default(0),
  nextActionAt: z.iso.datetime({ offset: true }).optional(),
  nextActionDescription: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(5000).optional(),
});

// status e convertedClientId nunca são setáveis via PATCH — status é
// derivado do estágio, e convertedClientId só é preenchido pela rota de
// conversão.
export const updateLeadSchema = createLeadSchema.partial();

export const listLeadsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  stage: z.string().trim().max(50).optional(), // aceita slug ou id do estágio
  owner: idSchema.optional(),
  source: leadSourceSchema.optional(),
});

export const leadIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Atividades
 */

export const createActivitySchema = z.object({
  type: crmActivityTypeSchema,
  title: z.string().trim().min(1, 'Título é obrigatório.').max(200),
  description: z.string().trim().max(5000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export const listActivitiesQuerySchema = paginationQuerySchema;
