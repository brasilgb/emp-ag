import { z } from 'zod';

/*
 * Validação de entrada do módulo Projetos + Tarefas. O backend nunca confia
 * apenas na validação do frontend — todo payload passa por aqui antes de
 * tocar o banco.
 */

export const projectStatusSchema = z.enum([
  'draft',
  'planned',
  'in_progress',
  'on_hold',
  'completed',
  'cancelled',
]);

// Compartilhado entre projetos e tarefas.
export const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const milestoneStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

export const taskStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'cancelled',
]);

export const executionTypeSchema = z.enum(['human', 'agent', 'external']);

const idSchema = z.coerce
  .number({ error: 'ID inválido.' })
  .int('ID inválido.')
  .positive('ID inválido.');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Aceita number ou string, sempre armazenado como string com 2 casas
// decimais na coluna numeric — nunca float. Mesmo molde de
// monetaryValueSchema em src/schemas/crm.ts.
export const monetaryValueSchema = z
  .union([z.number(), z.string()])
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
    error: 'Valor monetário inválido.',
  })
  .transform((value) => Number(value).toFixed(2));

export const hoursSchema = z
  .union([z.number(), z.string()])
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
    error: 'Quantidade de horas inválida.',
  })
  .transform((value) => Number(value).toFixed(2));

/*
 * Projetos
 */

export const createProjectSchema = z.object({
  clientId: idSchema,
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  description: z.string().trim().max(5000).optional(),
  status: projectStatusSchema.default('draft'),
  priority: prioritySchema.default('normal'),
  ownerUserId: idSchema.optional(),
  startDate: z.iso.date('Data inválida.').optional(),
  dueDate: z.iso.date('Data inválida.').optional(),
  estimatedValue: monetaryValueSchema.optional(),
  estimatedHours: hoursSchema.optional(),
  notes: z.string().trim().max(5000).optional(),
  // progress é sempre calculado pelo backend — nunca aceito aqui.
});

export const updateProjectSchema = createProjectSchema.partial();

export const listProjectsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: projectStatusSchema.optional(),
  priority: prioritySchema.optional(),
  client: idSchema.optional(),
  owner: idSchema.optional(),
});

export const projectIdParamSchema = z.object({
  id: idSchema,
});

/*
 * Milestones
 */

export const createMilestoneSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  description: z.string().trim().max(5000).optional(),
  status: milestoneStatusSchema.default('pending'),
  position: z.coerce.number().int().min(0).default(0),
  dueDate: z.iso.date('Data inválida.').optional(),
});

export const updateMilestoneSchema = createMilestoneSchema.partial();

export const milestoneParamSchema = projectIdParamSchema.extend({
  milestoneId: idSchema,
});

/*
 * Tarefas
 */

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Título é obrigatório.').max(200),
  description: z.string().trim().max(5000).optional(),
  status: taskStatusSchema.default('todo'),
  priority: prioritySchema.default('normal'),
  assigneeUserId: idSchema.optional(),
  milestoneId: idSchema.optional(),
  executionType: executionTypeSchema.default('human'),
  executionRef: z.string().trim().max(255).optional(),
  dueDate: z.iso.date('Data inválida.').optional(),
  estimatedHours: hoursSchema.optional(),
  position: z.coerce.number().int().min(0).optional(),
});

// startedAt/completedAt nunca são setáveis via PATCH — são sempre derivados
// pelo backend a partir da mudança de status.
export const updateTaskSchema = createTaskSchema.partial().extend({
  actualHours: hoursSchema.optional(),
});

export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  assignee: idSchema.optional(),
  milestone: idSchema.optional(),
  // Aceita o sentinel "overdue" (due_date < hoje AND status aberto) ou uma
  // data ISO exata (YYYY-MM-DD) para filtrar por prazo específico.
  due: z.string().trim().max(20).optional(),
});

export const taskParamSchema = projectIdParamSchema.extend({
  taskId: idSchema,
});

/*
 * Comentários
 */

export const createCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comentário não pode ser vazio.').max(5000),
});

export const listCommentsQuerySchema = paginationQuerySchema;

/*
 * Histórico
 */

export const listHistoryQuerySchema = paginationQuerySchema;
