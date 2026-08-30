import { z } from 'zod';

/*
 * Validação de entrada do módulo Suporte. O backend nunca confia apenas na
 * validação do frontend — todo payload passa por aqui antes de tocar o
 * banco. Arquivo independente de crm.ts/projects.ts/financial.ts, de
 * propósito (mesmo padrão de duplicação dos outros módulos).
 */

// Status real, persistido — "overdue" nunca é um status: é sempre derivado
// (ver routes/support/helpers.ts) e só existe como filtro booleano na
// listagem.
export const ticketStatusSchema = z.enum([
  'open',
  'triage',
  'in_progress',
  'waiting_customer',
  'waiting_internal',
  'resolved',
  'closed',
  'cancelled',
]);

export const prioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

export const sourceSchema = z.enum([
  'manual',
  'email',
  'whatsapp',
  'phone',
  'website',
  'internal',
  'other',
]);

export const messageTypeSchema = z.enum(['message', 'note', 'system']);

const idSchema = z.coerce
  .number({ error: 'ID inválido.' })
  .int('ID inválido.')
  .positive('ID inválido.');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/*
 * Categorias
 */

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'Slug é obrigatório.')
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Slug deve conter apenas letras minúsculas, números e "_".'),
  description: z.string().trim().max(2000).optional(),
  defaultPriority: prioritySchema.default('normal'),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const listCategoriesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  isActive: z.coerce.boolean().optional(),
});

export const categoryIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Tickets
 */

export const createTicketSchema = z.object({
  clientId: idSchema,
  projectId: idSchema.optional(),
  categoryId: idSchema,
  title: z.string().trim().min(1, 'Título é obrigatório.').max(255),
  description: z.string().trim().max(10000).optional(),
  priority: prioritySchema.optional(),
  source: sourceSchema.default('manual'),
});

// status/resolution/ownerUserId podem vir aqui, mas a autorização de quem
// pode setar cada campo é granular e resolvida na rota (ver
// routes/support/tickets.ts), não no schema.
export const updateTicketSchema = z.object({
  clientId: idSchema.optional(),
  projectId: idSchema.optional(),
  categoryId: idSchema.optional(),
  title: z.string().trim().min(1, 'Título é obrigatório.').max(255).optional(),
  description: z.string().trim().max(10000).optional(),
  priority: prioritySchema.optional(),
  source: sourceSchema.optional(),
  ownerUserId: idSchema.optional(),
  status: ticketStatusSchema.optional(),
  resolution: z.string().trim().max(10000).optional(),
});

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: ticketStatusSchema.optional(),
  priority: prioritySchema.optional(),
  category: idSchema.optional(),
  client: idSchema.optional(),
  project: idSchema.optional(),
  owner: idSchema.optional(),
  source: sourceSchema.optional(),
  overdue: z.coerce.boolean().optional(),
});

export const ticketIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Mensagens
 */

export const createMessageSchema = z.object({
  type: messageTypeSchema.default('message'),
  content: z.string().trim().min(1, 'Conteúdo é obrigatório.').max(10000),
  isInternal: z.boolean().default(false),
});

export const listMessagesQuerySchema = paginationQuerySchema;
export const listHistoryQuerySchema = paginationQuerySchema;
