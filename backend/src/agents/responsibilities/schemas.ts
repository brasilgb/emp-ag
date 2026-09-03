import { z } from 'zod';

import { ESCALATION_POLICIES, RESPONSIBILITY_PRIORITIES, RESPONSIBILITY_TYPES } from './types.js';

// Mesmo enum literal já usado em goals/schemas.ts (domainSchema) —
// reaproveitado aqui para não criar um segundo vocabulário de domínio.
const domainSchema = z.enum(['crm', 'projects', 'finance', 'support', 'agents']);

export const responsibilityIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Agentes v2.6 (correio.md seção 28) — validação em CAMADA DUPLA, mesmo
 * princípio de `agent_approvals`/`agent_responsibilities` (CHECK no
 * banco): o Zod `.refine()` aqui é a primeira camada (erro 400 amigável
 * antes de chegar ao banco); o CHECK constraint (schema/agent-responsibilities.ts)
 * é a segunda, definitiva — nunca confiar só na validação da aplicação.
 */
const escalationTargetRefinement = <T extends { escalationPolicy: string; escalationTargetAgentId?: number | null; escalationTargetUserId?: number | null }>(
  data: T,
  ctx: z.RefinementCtx,
) => {
  const needsAgent = data.escalationPolicy === 'agent' || data.escalationPolicy === 'agent_then_human';
  const needsUser = data.escalationPolicy === 'human' || data.escalationPolicy === 'agent_then_human';

  if (needsAgent && !data.escalationTargetAgentId) {
    ctx.addIssue({ code: 'custom', message: 'escalationTargetAgentId é obrigatório para escalationPolicy "agent"/"agent_then_human".', path: ['escalationTargetAgentId'] });
  }
  if (needsUser && !data.escalationTargetUserId) {
    ctx.addIssue({ code: 'custom', message: 'escalationTargetUserId é obrigatório para escalationPolicy "human"/"agent_then_human".', path: ['escalationTargetUserId'] });
  }
};

export const createResponsibilitySchema = z
  .object({
    agentId: z.number().int().positive(),
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(2000).optional(),
    domain: domainSchema,
    responsibilityType: z.enum(RESPONSIBILITY_TYPES),
    priority: z.enum(RESPONSIBILITY_PRIORITIES).default('medium'),
    conditions: z.record(z.string(), z.unknown()).default({}),
    escalationPolicy: z.enum(ESCALATION_POLICIES).default('none'),
    escalationTargetAgentId: z.number().int().positive().optional(),
    escalationTargetUserId: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine(escalationTargetRefinement);

export const updateResponsibilitySchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    priority: z.enum(RESPONSIBILITY_PRIORITIES).optional(),
    conditions: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
    escalationPolicy: z.enum(ESCALATION_POLICIES).optional(),
    escalationTargetAgentId: z.number().int().positive().nullable().optional(),
    escalationTargetUserId: z.number().int().positive().nullable().optional(),
  })
  .strict();

export const listResponsibilitiesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  agentId: z.coerce.number().int().positive().optional(),
  domain: domainSchema.optional(),
  responsibilityType: z.enum(RESPONSIBILITY_TYPES).optional(),
  enabled: z.enum(['true', 'false']).optional(),
});
