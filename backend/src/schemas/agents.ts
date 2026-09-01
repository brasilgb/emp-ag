import { z } from 'zod';

/*
 * Validação de entrada do módulo Agentes. O backend nunca confia apenas
 * na validação do frontend — todo payload passa por aqui antes de tocar
 * o banco ou o tool-registry. Arquivo independente dos demais
 * src/schemas/*.ts, de propósito (mesmo padrão de duplicação já usado
 * entre os outros módulos).
 */

const idSchema = z.coerce
  .number({ error: 'ID inválido.' })
  .int('ID inválido.')
  .positive('ID inválido.');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const agentIdParamSchema = z.object({
  id: idSchema,
});

export const listAgentToolsQuerySchema = z.object({
  department: z.string().trim().min(1).optional(),
});

// Input de POST /agents/execute (seção 31). `input` é o payload bruto da
// tool — validado de novo pelo Zod schema específico da tool dentro do
// pipeline (seção 51), nunca confiado aqui.
export const executeToolSchema = z.object({
  agentSlug: z.string().trim().min(1, 'agentSlug é obrigatório.'),
  toolHandler: z.string().trim().min(1, 'toolHandler é obrigatório.'),
  input: z.record(z.string(), z.unknown()).default({}),
  conversationId: idSchema.optional(),
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});

export const listExecutionsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([
      'pending',
      'running',
      'waiting_approval',
      'approved',
      'rejected',
      'completed',
      'failed',
      'cancelled',
    ])
    .optional(),
  agentId: idSchema.optional(),
});

export const executionIdParamSchema = z.object({
  id: idSchema,
});

export const listApprovalsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']).optional(),
});

export const approvalIdParamSchema = z.object({
  id: idSchema,
});

export const approvalDecisionSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});

// v1.1 — seção 30: feedback humano sobre uma interpretação do LLM
// Interpreter. Único formato aceito é o par correct/incorrect — nada além
// disso é gravado, e nada aqui reabre negociação sobre prompt/router/model
// (seção 31).
export const interpretationIdParamSchema = z.object({
  id: idSchema,
});

export const interpretationReviewSchema = z.object({
  verdict: z.enum(['correct', 'incorrect'], { error: 'verdict deve ser "correct" ou "incorrect".' }),
});

export const listConversationsQuerySchema = paginationQuerySchema;

export const createConversationSchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export const conversationIdParamSchema = z.object({
  id: idSchema,
});

export const createConversationMessageSchema = z.object({
  content: z.string().trim().min(1, 'Conteúdo é obrigatório.').max(10000),
});

// Input de POST /agents/chat (seção 33).
export const chatSchema = z.object({
  conversationId: idSchema.optional(),
  message: z.string().trim().min(1, 'message é obrigatória.').max(2000),
});

// Agentes v1.2 — Action Planning (correio.md seção 8/9). Input de
// POST /agents/action-plans: só o objetivo em texto livre, a estrutura do
// plano é responsabilidade do Action Planner + validator, nunca do
// cliente.
export const createActionPlanSchema = z.object({
  objective: z.string().trim().min(1, 'objective é obrigatório.').max(2000),
});

export const listActionPlansQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(['draft', 'evaluating', 'waiting_approval', 'executing', 'completed', 'partial', 'failed', 'cancelled'])
    .optional(),
});

export const actionPlanIdParamSchema = z.object({
  id: idSchema,
});
