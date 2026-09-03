import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import {
  createResponsibility,
  deleteResponsibility,
  getResponsibilityById,
  listResponsibilities,
  updateResponsibility,
} from '../../agents/responsibilities/service.js';
import {
  createResponsibilitySchema,
  listResponsibilitiesQuerySchema,
  responsibilityIdParamSchema,
  updateResponsibilitySchema,
} from '../../agents/responsibilities/schemas.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v2.6 (correio.md seção 18) — Agent Responsibilities API.
 * Leitura em `agents.responsibilities.read`, escrita em
 * `agents.responsibilities.manage` (avaliadas contra o catálogo real
 * antes de criar — nenhuma permission existente cobria "quem é
 * responsável por qual domínio", ver `executed.md`).
 */
export async function responsibilitiesRoutes(app: FastifyInstance) {
  app.get(
    '/responsibilities',
    { preHandler: [authenticate, requirePermission('agents.responsibilities.read')] },
    async (request, reply) => {
      const query = listResponsibilitiesQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listResponsibilities({
        page: query.data.page,
        limit: query.data.limit,
        agentId: query.data.agentId,
        domain: query.data.domain,
        responsibilityType: query.data.responsibilityType,
        enabled: query.data.enabled === undefined ? undefined : query.data.enabled === 'true',
      });

      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/responsibilities/:id',
    { preHandler: [authenticate, requirePermission('agents.responsibilities.read')] },
    async (request, reply) => {
      const params = responsibilityIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const responsibility = await getResponsibilityById(params.data.id);
      if (!responsibility) return notFound(reply, 'Responsibility não encontrada.');

      return { data: responsibility };
    },
  );

  app.post(
    '/responsibilities',
    { preHandler: [authenticate, requirePermission('agents.responsibilities.manage')] },
    async (request, reply) => {
      const body = createResponsibilitySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      try {
        const responsibility = await createResponsibility(body.data, currentUserId(request));
        return reply.code(201).send({ data: responsibility });
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.patch(
    '/responsibilities/:id',
    { preHandler: [authenticate, requirePermission('agents.responsibilities.manage')] },
    async (request, reply) => {
      const params = responsibilityIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = updateResponsibilitySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const responsibility = await getResponsibilityById(params.data.id);
      if (!responsibility) return notFound(reply, 'Responsibility não encontrada.');

      try {
        const updated = await updateResponsibility(responsibility, body.data, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.delete(
    '/responsibilities/:id',
    { preHandler: [authenticate, requirePermission('agents.responsibilities.manage')] },
    async (request, reply) => {
      const params = responsibilityIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const responsibility = await getResponsibilityById(params.data.id);
      if (!responsibility) return notFound(reply, 'Responsibility não encontrada.');

      try {
        await deleteResponsibility(responsibility, currentUserId(request));
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );
}
