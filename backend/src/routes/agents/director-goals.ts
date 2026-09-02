import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import {
  activateGoal,
  addGoalMetric,
  cancelGoal,
  createGoal,
  getGoalById,
  getGoalEvaluationHistory,
  getGoalMetrics,
  getGoalsOverview,
  listGoals,
  pauseGoal,
  updateGoal,
} from '../../agents/director/goals/goals-service.js';
import { evaluateDirectorGoal } from '../../agents/director/goals/evaluation-engine.js';
import { listMetricCatalog } from '../../agents/director/goals/metrics/catalog.js';
import {
  addGoalMetricSchema,
  cancelGoalSchema,
  createGoalSchema,
  goalIdParamSchema,
  listGoalsQuerySchema,
  updateGoalSchema,
} from '../../agents/director/goals/schemas.js';
import { listInitiatives } from '../../agents/director/goals/initiatives-service.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v2.0 (correio.md seção 15) — Director Goals API. Mesmo padrão
 * de routes/agents/director-decisions.ts (v1.9): leitura sob
 * `agents.read`, mutação sob a permission dedicada nova
 * (`agents.director.goals.manage`).
 */
export async function directorGoalsRoutes(app: FastifyInstance) {
  app.get(
    '/director/goals/overview',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async () => ({ data: await getGoalsOverview() }),
  );

  app.get(
    '/director/goals/metrics/catalog',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async () => ({ data: listMetricCatalog() }),
  );

  app.get(
    '/director/goals',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const query = listGoalsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listGoals(query.data);
      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.post(
    '/director/goals',
    { preHandler: [authenticate, requirePermission('agents.director.goals.manage')] },
    async (request, reply) => {
      const body = createGoalSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      try {
        const goal = await createGoal(body.data, currentUserId(request));
        return reply.code(201).send({ data: goal });
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.get(
    '/director/goals/:id',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const params = goalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const goal = await getGoalById(params.data.id);
      if (!goal) return notFound(reply, 'Goal não encontrado.');

      const [metrics, evaluations, initiatives] = await Promise.all([
        getGoalMetrics(goal.id),
        getGoalEvaluationHistory(goal.id),
        listInitiatives({ page: 1, limit: 100, goalId: goal.id }),
      ]);

      return { data: { goal, metrics, evaluations, initiatives: initiatives.rows } };
    },
  );

  app.patch(
    '/director/goals/:id',
    { preHandler: [authenticate, requirePermission('agents.director.goals.manage')] },
    async (request, reply) => {
      const params = goalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = updateGoalSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const goal = await getGoalById(params.data.id);
      if (!goal) return notFound(reply, 'Goal não encontrado.');

      try {
        const updated = await updateGoal(goal, body.data, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/director/goals/:id/metrics',
    { preHandler: [authenticate, requirePermission('agents.director.goals.manage')] },
    async (request, reply) => {
      const params = goalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = addGoalMetricSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const goal = await getGoalById(params.data.id);
      if (!goal) return notFound(reply, 'Goal não encontrado.');

      try {
        const metric = await addGoalMetric(goal, body.data, currentUserId(request));
        return reply.code(201).send({ data: metric });
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  for (const [action, handler] of [
    ['activate', activateGoal],
    ['pause', pauseGoal],
  ] as const) {
    app.post(
      `/director/goals/:id/${action}`,
      { preHandler: [authenticate, requirePermission('agents.director.goals.manage')] },
      async (request, reply) => {
        const params = goalIdParamSchema.safeParse(request.params);
        if (!params.success) return badRequest(reply, params.error);

        const goal = await getGoalById(params.data.id);
        if (!goal) return notFound(reply, 'Goal não encontrado.');

        try {
          const updated = await handler(goal, currentUserId(request));
          return { data: updated };
        } catch (error) {
          if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
          throw error;
        }
      },
    );
  }

  app.post(
    '/director/goals/:id/cancel',
    { preHandler: [authenticate, requirePermission('agents.director.goals.manage')] },
    async (request, reply) => {
      const params = goalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = cancelGoalSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const goal = await getGoalById(params.data.id);
      if (!goal) return notFound(reply, 'Goal não encontrado.');

      try {
        const updated = await cancelGoal(goal, body.data.reason, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/director/goals/:id/evaluate',
    { preHandler: [authenticate, requirePermission('agents.director.goals.manage')] },
    async (request, reply) => {
      const params = goalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const result = await evaluateDirectorGoal(params.data.id);
      if (!result) return notFound(reply, 'Goal não encontrado.');

      return { data: result };
    },
  );
}
