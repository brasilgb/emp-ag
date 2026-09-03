import type { FastifyInstance } from 'fastify';

import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import {
  cancelActionProposal,
  createActionProposal,
  getActionProposalById,
  listActionProposalsForFollowUp,
  submitActionProposal,
} from '../../agents/followups/action-proposals-service.js';
import {
  actionProposalIdParamSchema,
  cancelActionProposalSchema,
  createActionProposalSchema,
  followUpIdParamForProposalsSchema,
  listActionProposalsQuerySchema,
} from '../../agents/followups/action-proposals-schemas.js';
import { getFollowUpById } from '../../agents/followups/service.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v2.8 (correio.md seção 18) — Operational Action Proposals API.
 * Leitura reaproveita `agents.followups.read` (avaliado e confirmado
 * adequado — seção 6: "primeiro verificar se alguma permission existente
 * relacionada a Action Plans ou FollowUps é semanticamente adequada");
 * escrita usa a única permission nova desta versão,
 * `agents.followups.actions.manage`.
 */
export async function actionProposalsRoutes(app: FastifyInstance) {
  app.get(
    '/follow-ups/:followUpId/action-proposals',
    { preHandler: [authenticate, requirePermission('agents.followups.read')] },
    async (request, reply) => {
      const params = followUpIdParamForProposalsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const query = listActionProposalsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const followUp = await getFollowUpById(params.data.followUpId);
      if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

      const { rows, total } = await listActionProposalsForFollowUp({ followUpId: followUp.id, page: query.data.page, limit: query.data.limit });
      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/action-proposals/:id',
    { preHandler: [authenticate, requirePermission('agents.followups.read')] },
    async (request, reply) => {
      const params = actionProposalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const proposal = await getActionProposalById(params.data.id);
      if (!proposal) return notFound(reply, 'Proposta não encontrada.');

      return { data: proposal };
    },
  );

  app.post(
    '/follow-ups/:followUpId/action-proposals',
    { preHandler: [authenticate, requirePermission('agents.followups.actions.manage')] },
    async (request, reply) => {
      const params = followUpIdParamForProposalsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = createActionProposalSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const followUp = await getFollowUpById(params.data.followUpId);
      if (!followUp) return notFound(reply, 'FollowUp não encontrado.');

      try {
        const proposal = await createActionProposal(followUp, body.data, currentUserId(request));
        return reply.code(201).send({ data: proposal });
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/action-proposals/:id/submit',
    { preHandler: [authenticate, requirePermission('agents.followups.actions.manage')] },
    async (request, reply) => {
      const params = actionProposalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const proposal = await getActionProposalById(params.data.id);
      if (!proposal) return notFound(reply, 'Proposta não encontrada.');

      try {
        const updated = await submitActionProposal(proposal, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );

  app.post(
    '/action-proposals/:id/cancel',
    { preHandler: [authenticate, requirePermission('agents.followups.actions.manage')] },
    async (request, reply) => {
      const params = actionProposalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = cancelActionProposalSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const proposal = await getActionProposalById(params.data.id);
      if (!proposal) return notFound(reply, 'Proposta não encontrada.');

      try {
        const updated = await cancelActionProposal(proposal, body.data.reason, currentUserId(request));
        return { data: updated };
      } catch (error) {
        if (error instanceof AgentError) return reply.code(error.status).send({ error: error.code, message: error.message });
        throw error;
      }
    },
  );
}
