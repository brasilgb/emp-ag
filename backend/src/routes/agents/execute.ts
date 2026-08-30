import type { FastifyInstance } from 'fastify';

import { executeTool } from '../../agents/execution/pipeline.js';
import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentRateLimit } from '../../agents/security/rate-limit.js';
import { executeToolSchema } from '../../schemas/agents.js';

import { badRequest, currentUserId } from './helpers.js';

export async function executeRoutes(app: FastifyInstance) {
  app.post(
    '/execute',
    {
      preHandler: [
        authenticate,
        agentRateLimit('execute'),
        requirePermission('agents.use'),
        requirePermission('agents.execute'),
      ],
    },
    async (request, reply) => {
      const body = executeToolSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const outcome = await executeTool({
        userId,
        agentSlug: body.data.agentSlug,
        toolHandler: body.data.toolHandler,
        input: body.data.input,
        conversationId: body.data.conversationId ?? null,
        idempotencyKey: body.data.idempotencyKey ?? null,
      });

      if (outcome.status === 'rejected' || outcome.status === 'failed') {
        const agentError = new AgentError(outcome.error!.code, outcome.error!.message);

        return reply.code(agentError.status).send({
          error: agentError.code,
          message: agentError.message,
          executionId: outcome.executionId,
        });
      }

      if (outcome.status === 'waiting_approval') {
        return reply.code(202).send({
          status: 'waiting_approval',
          executionId: outcome.executionId,
          approvalId: outcome.approvalId,
          message: 'Ação sujeita a aprovação humana. Solicitação registrada.',
        });
      }

      return reply.code(200).send({
        status: 'completed',
        executionId: outcome.executionId,
        idempotentReplay: outcome.idempotentReplay,
        result: outcome.result,
      });
    },
  );
}
