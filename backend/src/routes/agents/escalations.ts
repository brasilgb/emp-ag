import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { acknowledgeEscalation, dismissEscalation, getEscalationById, listEscalations, resolveEscalation } from '../../agents/escalations/service.js';
import { dismissEscalationSchema, escalationIdParamSchema, listEscalationsQuerySchema } from '../../agents/escalations/schemas.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v2.6 (correio.md seções 18/19) — Operational Escalations API.
 * Leitura em `agents.escalations.read`, transições
 * (acknowledge/resolve/dismiss) em `agents.escalations.manage`. NENHUM
 * `POST /agents/escalations` de criação livre (seção 19: "se não houver
 * caso real nesta versão, NÃO criar" — o único caminho real de criação é
 * a integração interna com o Operational Supervisor,
 * `escalations/supervisor-integration.ts`, nunca exposta via HTTP).
 */
export async function escalationsRoutes(app: FastifyInstance) {
  app.get(
    '/escalations',
    { preHandler: [authenticate, requirePermission('agents.escalations.read')] },
    async (request, reply) => {
      const query = listEscalationsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listEscalations(query.data);
      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/escalations/:id',
    { preHandler: [authenticate, requirePermission('agents.escalations.read')] },
    async (request, reply) => {
      const params = escalationIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const escalation = await getEscalationById(params.data.id);
      if (!escalation) return notFound(reply, 'Escalation não encontrada.');

      return { data: escalation };
    },
  );

  for (const [action, handler] of [
    ['acknowledge', acknowledgeEscalation],
    ['resolve', resolveEscalation],
  ] as const) {
    app.post(
      `/escalations/:id/${action}`,
      { preHandler: [authenticate, requirePermission('agents.escalations.manage')] },
      async (request, reply) => {
        const params = escalationIdParamSchema.safeParse(request.params);
        if (!params.success) return badRequest(reply, params.error);

        const escalation = await getEscalationById(params.data.id);
        if (!escalation) return notFound(reply, 'Escalation não encontrada.');

        try {
          const updated = await handler(escalation, currentUserId(request));
          return { data: updated };
        } catch (error) {
          if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
          throw error;
        }
      },
    );
  }

  app.post(
    '/escalations/:id/dismiss',
    { preHandler: [authenticate, requirePermission('agents.escalations.manage')] },
    async (request, reply) => {
      const params = escalationIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = dismissEscalationSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const escalation = await getEscalationById(params.data.id);
      if (!escalation) return notFound(reply, 'Escalation não encontrada.');

      try {
        const updated = await dismissEscalation(escalation, body.data.reason, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );
}
