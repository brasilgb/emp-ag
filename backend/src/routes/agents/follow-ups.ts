import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { getFollowUpTimeline } from '../../agents/operations/control-center-service.js';
import {
  completeFollowUp,
  createManualFollowUp,
  dismissFollowUp,
  getFollowUpById,
  listFollowUps,
  reassignFollowUp,
  resumeFollowUp,
  startFollowUp,
  waitFollowUp,
} from '../../agents/followups/service.js';
import {
  completeFollowUpSchema,
  createManualFollowUpSchema,
  dismissFollowUpSchema,
  followUpIdParamSchema,
  listFollowUpsQuerySchema,
  reassignFollowUpSchema,
  waitFollowUpSchema,
} from '../../agents/followups/schemas.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v2.7 (correio.md seção 17) — Operational FollowUps API.
 * Leitura em `agents.followups.read`; toda escrita (criação gerencial e
 * transições) em `agents.followups.manage`. Nenhum endpoint que altere
 * `status` livremente — só ações específicas por transição (seção 4/17:
 * "não expor endpoint que permita alterar livremente status").
 */
export async function followUpsRoutes(app: FastifyInstance) {
  app.get(
    '/follow-ups',
    { preHandler: [authenticate, requirePermission('agents.followups.read')] },
    async (request, reply) => {
      const query = listFollowUpsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listFollowUps({
        page: query.data.page,
        limit: query.data.limit,
        status: query.data.status,
        priority: query.data.priority,
        ownerAgentId: query.data.ownerAgentId,
        assignedUserId: query.data.assignedUserId,
        responsibilityId: query.data.responsibilityId,
        escalationId: query.data.escalationId,
        overdue: query.data.overdue === 'true',
      });

      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/follow-ups/:id',
    { preHandler: [authenticate, requirePermission('agents.followups.read')] },
    async (request, reply) => {
      const params = followUpIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const followUp = await getFollowUpById(params.data.id);
      if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

      return { data: followUp };
    },
  );

  // Agentes v3.0 (correio.md "Etapa 3") — timeline operacional derivada
  // 100% do audit log existente + das FKs reais da cadeia Responsibility
  // → Escalation → FollowUp → Proposal → Action Plan → Approval — nenhuma
  // tabela de histórico nova. Mesma permission de leitura do FollowUp
  // (`agents.followups.read`); eventos de nível Action Plan/Item/Approval
  // só entram na resposta se o ator também tiver `agents.plan.read`
  // (decidido dentro de `getFollowUpTimeline`, no backend — nunca
  // filtrado só no frontend, seção "Etapa 6").
  app.get(
    '/follow-ups/:id/timeline',
    { preHandler: [authenticate, requirePermission('agents.followups.read')] },
    async (request, reply) => {
      const params = followUpIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const timeline = await getFollowUpTimeline(params.data.id, currentUserId(request));
      if (!timeline) return notFound(reply, 'FollowUp não encontrado.');

      return { data: timeline };
    },
  );

  app.post(
    '/follow-ups',
    { preHandler: [authenticate, requirePermission('agents.followups.manage')] },
    async (request, reply) => {
      const body = createManualFollowUpSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      try {
        const followUp = await createManualFollowUp(body.data, currentUserId(request));
        return reply.code(201).send({ data: followUp });
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  for (const [action, handler] of [
    ['start', startFollowUp],
    ['resume', resumeFollowUp],
  ] as const) {
    app.post(
      `/follow-ups/:id/${action}`,
      { preHandler: [authenticate, requirePermission('agents.followups.manage')] },
      async (request, reply) => {
        const params = followUpIdParamSchema.safeParse(request.params);
        if (!params.success) return badRequest(reply, params.error);

        const followUp = await getFollowUpById(params.data.id);
        if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

        try {
          const updated = await handler(followUp, currentUserId(request));
          return { data: updated };
        } catch (error) {
          if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
          throw error;
        }
      },
    );
  }

  app.post(
    '/follow-ups/:id/wait',
    { preHandler: [authenticate, requirePermission('agents.followups.manage')] },
    async (request, reply) => {
      const params = followUpIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = waitFollowUpSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const followUp = await getFollowUpById(params.data.id);
      if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

      try {
        const updated = await waitFollowUp(followUp, body.data, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/follow-ups/:id/complete',
    { preHandler: [authenticate, requirePermission('agents.followups.manage')] },
    async (request, reply) => {
      const params = followUpIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = completeFollowUpSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const followUp = await getFollowUpById(params.data.id);
      if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

      try {
        const updated = await completeFollowUp(followUp, body.data.resolution, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/follow-ups/:id/dismiss',
    { preHandler: [authenticate, requirePermission('agents.followups.manage')] },
    async (request, reply) => {
      const params = followUpIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = dismissFollowUpSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const followUp = await getFollowUpById(params.data.id);
      if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

      try {
        const updated = await dismissFollowUp(followUp, body.data.reason, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/follow-ups/:id/reassign',
    { preHandler: [authenticate, requirePermission('agents.followups.manage')] },
    async (request, reply) => {
      const params = followUpIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = reassignFollowUpSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const followUp = await getFollowUpById(params.data.id);
      if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

      try {
        const updated = await reassignFollowUp(followUp, body.data.assignedUserId, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );
}
