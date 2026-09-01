import { z } from 'zod';

/*
 * Agentes v1.2 (correio.md, seção 1) — contrato estrutural do Action Plan
 * que o LLM pode gerar. `.strict()` em cada objeto, mesmo mecanismo já
 * usado em agents/llm/schema.ts, garante que campos fora desta lista
 * (sql, code, shell, url, handler, permission, autonomy_level ou qualquer
 * outro) são rejeitados pelo Zod antes de qualquer outra validação —
 * nunca por uma checagem de blocklist à parte.
 */

export const plannedActionSchema = z
  .object({
    id: z.string().trim().min(1).max(50),
    agent: z.string().trim().min(1),
    tool: z.string().trim().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
    reason: z.string().trim().min(1).max(500),
    confidence: z.number().min(0).max(1),
    dependencies: z.array(z.string().trim().min(1)).max(10).optional(),
  })
  .strict();

export const actionPlanSchema = z
  .object({
    objective: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(1000),
    actions: z.array(plannedActionSchema).max(10),
  })
  .strict();

export type PlannedAction = z.infer<typeof plannedActionSchema>;
export type ActionPlanPayload = z.infer<typeof actionPlanSchema>;

export const MAX_ACTIONS_PER_PLAN = 10;
