import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentRateLimit } from '../../agents/security/rate-limit.js';
import {
  acknowledgeDecision,
  assignDecision,
  dismissDecision,
  proposeActionForDecision,
} from '../../agents/director/decisions/actions-service.js';
import { getPendingApprovalForPlan, getDecisionById, getQueueOverview, listDecisions } from '../../agents/director/decisions/queue-service.js';
import {
  assignDecisionSchema,
  decisionIdParamSchema,
  dismissDecisionSchema,
  listDecisionsQuerySchema,
} from '../../agents/director/decisions/schemas.js';
import { syncDirectorDecisionQueue } from '../../agents/director/decisions/sync-service.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v1.9 (correio.md seção 18) — Director Decision Queue API.
 * `POST /director/signals/:id/propose` (v1.8) continua existindo em
 * routes/agents/director.ts, sem nenhuma mudança — esta é uma API nova
 * e paralela, operando sobre Decision Items persistidos (correio.md
 * seção 13, opção A).
 */
export async function directorDecisionsRoutes(app: FastifyInstance) {
  app.get(
    '/director/decisions',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const query = listDecisionsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listDecisions(query.data);
      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/director/decisions/overview',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async () => ({ data: await getQueueOverview() }),
  );

  app.get(
    '/director/decisions/:id',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const params = decisionIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const decision = await getDecisionById(params.data.id);
      if (!decision) return notFound(reply, 'Decision Item não encontrado.');

      const pendingApproval = await getPendingApprovalForPlan(decision.actionPlanId);

      return { data: { decision, pendingApproval } };
    },
  );

  // Agentes v1.9 (correio.md seção 21) — trigger administrativo direto,
  // ao lado da tool mutante (director.sync_decision_queue, para o Job
  // recorrente via Planner/LLM). Ambos chamam a MESMA função
  // (syncDirectorDecisionQueue), nenhuma lógica duplicada — só dois
  // pontos de entrada com propósitos diferentes: operador humano
  // imediato vs. Job orientado a LLM.
  app.post(
    '/director/decisions/sync',
    { preHandler: [authenticate, requirePermission('agents.director.decisions.manage')] },
    async () => ({ data: await syncDirectorDecisionQueue() }),
  );

  app.post(
    '/director/decisions/:id/acknowledge',
    { preHandler: [authenticate, requirePermission('agents.director.decisions.manage')] },
    async (request, reply) => {
      const params = decisionIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const decision = await getDecisionById(params.data.id);
      if (!decision) return notFound(reply, 'Decision Item não encontrado.');

      try {
        const updated = await acknowledgeDecision(decision, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/director/decisions/:id/assign',
    { preHandler: [authenticate, requirePermission('agents.director.decisions.manage')] },
    async (request, reply) => {
      const params = decisionIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = assignDecisionSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const decision = await getDecisionById(params.data.id);
      if (!decision) return notFound(reply, 'Decision Item não encontrado.');

      try {
        const updated = await assignDecision(decision, body.data.userId, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/director/decisions/:id/dismiss',
    { preHandler: [authenticate, requirePermission('agents.director.decisions.manage')] },
    async (request, reply) => {
      const params = decisionIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = dismissDecisionSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const decision = await getDecisionById(params.data.id);
      if (!decision) return notFound(reply, 'Decision Item não encontrado.');

      try {
        const updated = await dismissDecision(decision, body.data.reason, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/director/decisions/:id/propose',
    {
      preHandler: [
        authenticate,
        agentRateLimit('plan'),
        requirePermission('agents.use'),
        requirePermission('agents.plan'),
      ],
    },
    async (request, reply) => {
      const params = decisionIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const decision = await getDecisionById(params.data.id);
      if (!decision) return notFound(reply, 'Decision Item não encontrado.');

      try {
        const result = await proposeActionForDecision(decision, currentUserId(request));
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
