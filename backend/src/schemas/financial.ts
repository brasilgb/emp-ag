import { z } from 'zod';

/*
 * Validação de entrada do módulo Financeiro. O backend nunca confia apenas
 * na validação do frontend — todo payload passa por aqui antes de tocar o
 * banco. Arquivo independente de src/schemas/crm.ts e projects.ts, de
 * propósito (mesmo padrão de duplicação já usado entre os outros módulos).
 */

export const financialEntryTypeSchema = z.enum(['income', 'expense']);

// Status real, persistido — nunca inclui "overdue" (sempre derivado, ver
// routes/financial/helpers.ts). "overdue" só é aceito como valor de FILTRO
// em listEntriesQuerySchema.
export const financialEntryStatusSchema = z.enum(['pending', 'paid', 'cancelled']);
export const financialEntryStatusFilterSchema = z.enum([
  'pending',
  'paid',
  'cancelled',
  'overdue',
]);

export const financialCategoryTypeSchema = z.enum(['income', 'expense', 'both']);

export const paymentMethodSchema = z.enum([
  'pix',
  'bank_transfer',
  'credit_card',
  'debit_card',
  'cash',
  'boleto',
  'paypal',
  'mercado_pago',
  'other',
]);

// Aceita number ou string, sempre armazenado como string com 2 casas
// decimais na coluna numeric — nunca float. Exige valor estritamente
// positivo (amount > 0 / payment.amount > 0 — ver seção 36 da spec).
export const monetaryValueSchema = z
  .union([z.number(), z.string()])
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, {
    error: 'Valor monetário deve ser maior que zero.',
  })
  .transform((value) => Number(value).toFixed(2));

const idSchema = z.coerce
  .number({ error: 'ID inválido.' })
  .int('ID inválido.')
  .positive('ID inválido.');

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).');

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
  type: financialCategoryTypeSchema,
  isActive: z.boolean().default(true),
});

// isSystem nunca é setável via payload — só o seed cria categorias de
// sistema.
export const updateCategorySchema = createCategorySchema.partial();

export const listCategoriesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  type: financialCategoryTypeSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});

export const categoryIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Lançamentos
 */

export const createEntrySchema = z.object({
  type: financialEntryTypeSchema,
  categoryId: idSchema,
  clientId: idSchema.optional(),
  projectId: idSchema.optional(),
  description: z.string().trim().min(1, 'Descrição é obrigatória.').max(255),
  amount: monetaryValueSchema,
  issueDate: dateStringSchema,
  dueDate: dateStringSchema,
  competenceDate: dateStringSchema,
  paymentMethod: paymentMethodSchema.optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5000).optional(),
});

// status e paidAt nunca são setáveis via payload — status é derivado dos
// pagamentos (ver settleEntryPayment em routes/financial/helpers.ts).
export const updateEntrySchema = createEntrySchema.partial();

export const listEntriesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  type: financialEntryTypeSchema.optional(),
  status: financialEntryStatusFilterSchema.optional(),
  category: idSchema.optional(),
  client: idSchema.optional(),
  project: idSchema.optional(),
  due_from: dateStringSchema.optional(),
  due_to: dateStringSchema.optional(),
  competence_from: dateStringSchema.optional(),
  competence_to: dateStringSchema.optional(),
});

export const entryIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Pagamentos
 */

export const createPaymentSchema = z.object({
  amount: monetaryValueSchema,
  paidAt: z.iso.datetime({ offset: true }).optional(),
  paymentMethod: paymentMethodSchema.optional(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export const listPaymentsQuerySchema = paginationQuerySchema;

/*
 * Fluxo de caixa / previsão / resumo por projeto
 */

export const cashFlowQuerySchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema,
  })
  .refine((value) => value.to >= value.from, {
    error: 'O período final deve ser maior ou igual ao inicial.',
    path: ['to'],
  })
  .refine(
    (value) => {
      const diffMs = new Date(value.to).getTime() - new Date(value.from).getTime();
      return diffMs / (1000 * 60 * 60 * 24) <= 366;
    },
    { error: 'O período não pode exceder 366 dias.', path: ['to'] },
  );

export const projectSummaryParamSchema = z.object({
  projectId: idSchema,
});
