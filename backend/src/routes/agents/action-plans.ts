import type { FastifyInstance } from 'fastify';
import { count, desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentActionPlanItems, agentActionPlans } from '../../db/schema/index.js';
import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentRateLimit } from '../../agents/security/rate-limit.js';
import { executeActionPlan } from '../../agents/executor/action-plan-executor.js';
import { planEvaluateAndPersistActionPlan } from '../../agents/orchestration/create-action-plan.js';
import {
  actionPlanIdParamSchema,
  createActionPlanSchema,
  listActionPlansQuerySchema,
} from '../../schemas/agents.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

async function loadPlanWithItems(planId: number) {
  const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, planId)).limit(1);

  if (!plan) {
    return null;
  }

  const items = await db
    .select()
    .from(agentActionPlanItems)
    .where(eq(agentActionPlanItems.planId, planId))
    .orderBy(agentActionPlanItems.sequence);

  return { plan, items };
}

export async function actionPlansRoutes(app: FastifyInstance) {
  /**
   * Ponto de entrada do Diretor Virtual para múltiplas ações
   * (correio.md v1.2 seção 9): objetivo em texto livre → Action Planner
   * (LLM) → validator (Zod + registry) → Action Policy Evaluator por ação
   * → persiste plano + itens → executa de imediato as ações 'execute'
   * (approval_required fica esperando POST /agents/approvals/:id/approve).
   */
  app.post(
    '/action-plans',
    {
      preHandler: [
        authenticate,
        agentRateLimit('plan'),
        requirePermission('agents.use'),
        requirePermission('agents.plan'),
      ],
    },
    async (request, reply) => {
      const body = createActionPlanSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      // Núcleo compartilhado com agents/jobs/job-runner.ts (correio.md
      // v1.3 — nenhum segundo mecanismo de execução): planeja, valida,
      // avalia política por ação e persiste plano+itens+approvals.
      const created = await planEvaluateAndPersistActionPlan({
        requestedBy: userId,
        objective: body.data.objective,
      });

      if (!created.ok) {
        if (created.code === 'validation_error') {
          return reply.code(400).send({
            error: 'validation_error',
            message: created.message,
            details: created.details,
          });
        }

        const agentError = new AgentError(created.code, created.message);
        return reply.code(agentError.status).send({ error: agentError.code, message: agentError.message });
      }

      const finalPlan = await executeActionPlan(created.plan.id, userId);
      const finalItems = await db
        .select()
        .from(agentActionPlanItems)
        .where(eq(agentActionPlanItems.planId, created.plan.id))
        .orderBy(agentActionPlanItems.sequence);

      return reply.code(201).send({ data: { plan: finalPlan, items: finalItems } });
    },
  );

  app.get(
    '/action-plans',
    {
      preHandler: [authenticate, requirePermission('agents.plan.read')],
    },
    async (request, reply) => {
      const query = listActionPlansQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, status } = query.data;
      const where = status ? eq(agentActionPlans.status, status) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select({
            id: agentActionPlans.id,
            objective: agentActionPlans.objective,
            summary: agentActionPlans.summary,
            status: agentActionPlans.status,
            requestedBy: agentActionPlans.requestedBy,
            llmProvider: agentActionPlans.llmProvider,
            llmModel: agentActionPlans.llmModel,
            createdAt: agentActionPlans.createdAt,
            completedAt: agentActionPlans.completedAt,
          })
          .from(agentActionPlans)
          .where(where)
          .orderBy(desc(agentActionPlans.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentActionPlans).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.get(
    '/action-plans/:id',
    {
      preHandler: [authenticate, requirePermission('agents.plan.read')],
    },
    async (request, reply) => {
      const params = actionPlanIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const loaded = await loadPlanWithItems(params.data.id);

      if (!loaded) {
        return notFound(reply, 'Plano de ações não encontrado.');
      }

      return { data: loaded };
    },
  );
}
