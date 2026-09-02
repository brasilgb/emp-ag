import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentRateLimit } from '../../agents/security/rate-limit.js';
import {
  approveInitiative,
  cancelInitiative,
  completeInitiative,
  createInitiative,
  getInitiativeById,
  getPendingApprovalForInitiative,
  listInitiatives,
  proposeActionForInitiative,
  updateInitiative,
} from '../../agents/director/goals/initiatives-service.js';
import { getGoalById } from '../../agents/director/goals/goals-service.js';
import {
  cancelInitiativeSchema,
  createInitiativeSchema,
  goalIdRouteParamSchema,
  initiativeIdParamSchema,
  listInitiativesQuerySchema,
  updateInitiativeSchema,
} from '../../agents/director/goals/schemas.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v2.0 (correio.md seção 16) — Director Initiatives API. `propose`
 * exige `agents.use` + `agents.plan` (mesma exigência de
 * `POST /agents/action-plans` v1.2 e `POST /director/decisions/:id/propose`
 * v1.9) — nunca reaproveita `agents.director.initiatives.manage` para
 * isso, que cobre só o ciclo de vida (create/approve/cancel/complete).
 */
export async function directorInitiativesRoutes(app: FastifyInstance) {
  app.get(
    '/director/initiatives',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const query = listInitiativesQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listInitiatives(query.data);
      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/director/initiatives/:id',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const params = initiativeIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const initiative = await getInitiativeById(params.data.id);
      if (!initiative) return notFound(reply, 'Initiative não encontrada.');

      const pendingApproval = await getPendingApprovalForInitiative(initiative.actionPlanId);
      return { data: { initiative, pendingApproval } };
    },
  );

  app.post(
    '/director/goals/:goalId/initiatives',
    { preHandler: [authenticate, requirePermission('agents.director.initiatives.manage')] },
    async (request, reply) => {
      const params = goalIdRouteParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = createInitiativeSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const goal = await getGoalById(params.data.goalId);
      if (!goal) return notFound(reply, 'Goal não encontrado.');

      try {
        const initiative = await createInitiative(goal, body.data, currentUserId(request));
        return reply.code(201).send({ data: initiative });
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.patch(
    '/director/initiatives/:id',
    { preHandler: [authenticate, requirePermission('agents.director.initiatives.manage')] },
    async (request, reply) => {
      const params = initiativeIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = updateInitiativeSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const initiative = await getInitiativeById(params.data.id);
      if (!initiative) return notFound(reply, 'Initiative não encontrada.');

      try {
        const updated = await updateInitiative(initiative, body.data, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  for (const [action, handler] of [
    ['approve', approveInitiative],
    ['complete', completeInitiative],
  ] as const) {
    app.post(
      `/director/initiatives/:id/${action}`,
      { preHandler: [authenticate, requirePermission('agents.director.initiatives.manage')] },
      async (request, reply) => {
        const params = initiativeIdParamSchema.safeParse(request.params);
        if (!params.success) return badRequest(reply, params.error);

        const initiative = await getInitiativeById(params.data.id);
        if (!initiative) return notFound(reply, 'Initiative não encontrada.');

        try {
          const updated = await handler(initiative, currentUserId(request));
          return { data: updated };
        } catch (error) {
          if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
          throw error;
        }
      },
    );
  }

  app.post(
    '/director/initiatives/:id/cancel',
    { preHandler: [authenticate, requirePermission('agents.director.initiatives.manage')] },
    async (request, reply) => {
      const params = initiativeIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = cancelInitiativeSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const initiative = await getInitiativeById(params.data.id);
      if (!initiative) return notFound(reply, 'Initiative não encontrada.');

      try {
        const updated = await cancelInitiative(initiative, body.data.reason, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/director/initiatives/:id/propose',
    {
      preHandler: [
        authenticate,
        agentRateLimit('plan'),
        requirePermission('agents.use'),
        requirePermission('agents.plan'),
      ],
    },
    async (request, reply) => {
      const params = initiativeIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const initiative = await getInitiativeById(params.data.id);
      if (!initiative) return notFound(reply, 'Initiative não encontrada.');

      try {
        const result = await proposeActionForInitiative(initiative, currentUserId(request));
        return reply.code(201).send({ data: result });
      } catch (error) {
        if (error instanceof AgentError) {
          return reply.code(error.status).send({ error: error.code, message: error.message, details: error.details });
        }
        throw error;
      }
    },
  );
}
