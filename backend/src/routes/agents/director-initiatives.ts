import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentRateLimit } from '../../agents/security/rate-limit.js';
import {
  approveInitiative,
  cancelInitiative,
  createInitiative,
  getInitiativeById,
  getPendingApprovalForInitiative,
  listInitiatives,
  updateInitiative,
} from '../../agents/director/goals/initiatives-service.js';
import {
  completeInitiativeManually,
  getInitiativeExecutionView,
  startInitiativeExecution,
  syncInitiativeExecutionState,
} from '../../agents/director/goals/initiatives-execution-service.js';
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
 * Agentes v2.0/v2.1 (correio.md v2.1 seção 4/12) — Director Initiatives
 * API. `propose` (nome de rota mantido da v2.0 — v2.1 seção 12: "evitar
 * endpoints duplicados; aproveitar existentes sempre que possível" —
 * nenhuma rota `/start` nova, esta MESMA rota agora chama
 * `startInitiativeExecution`) exige `agents.use` + `agents.plan` (mesma
 * exigência de `POST /agents/action-plans` v1.2 / `.../decisions/:id/propose`
 * v1.9) — nunca reaproveita `agents.director.initiatives.manage`, que
 * cobre só o ciclo de vida administrativo (create/approve/cancel/
 * complete). v2.1 seção 4: catálogo de permissions já cobre
 * read/approve-cancel-complete/execute com essas duas permissions
 * existentes — nenhuma permission nova precisou ser criada.
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
    ['complete', completeInitiativeManually],
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
        const result = await startInitiativeExecution(initiative, currentUserId(request));
        // 201 só quando um Action Plan novo foi de fato criado (seção 3:
        // chamada idempotente devolvendo o plano existente é 200, nunca
        // um segundo "created").
        return reply.code(result.created ? 201 : 200).send({ data: result });
      } catch (error) {
        if (error instanceof AgentError) {
          return reply.code(error.status).send({ error: error.code, message: error.message, details: error.details });
        }
        throw error;
      }
    },
  );

  // Agentes v2.1 (correio.md seção 12/13) — visão operacional de
  // execução, derivada em tempo real do Action Plan real (nunca
  // persistida como estado próprio). Sincroniza `Initiative.status`
  // (conclusão/bloqueio automáticos, seção 8/9) a cada leitura — é o
  // único lugar de "check-on-read", sem job novo.
  app.get(
    '/director/initiatives/:id/execution',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const params = initiativeIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const initiative = await getInitiativeById(params.data.id);
      if (!initiative) return notFound(reply, 'Initiative não encontrada.');

      const view = await getInitiativeExecutionView(initiative);
      const synced = await syncInitiativeExecutionState(initiative, view, null);

      return { data: { initiative: synced, execution: view } };
    },
  );
}
