import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';

import { approveExecution, rejectExecution } from '../../agents/execution/approvals.js';
import { AgentError } from '../../agents/errors.js';
import { db } from '../../db/index.js';
import { agentApprovals, agentExecutions, agentTools, agents, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import {
  approvalDecisionSchema,
  approvalIdParamSchema,
  listApprovalsQuerySchema,
} from '../../schemas/agents.js';

import { badRequest, currentUserId, paginationMeta } from './helpers.js';

const requestedByAgents = agents;

const approvalSelection = {
  id: agentApprovals.id,
  executionId: agentApprovals.executionId,
  toolHandler: agentTools.handler,
  toolName: agentTools.name,
  agentName: requestedByAgents.name,
  agentSlug: requestedByAgents.slug,
  requestedForUserId: agentApprovals.requestedForUserId,
  requestedForUserName: users.name,
  status: agentApprovals.status,
  reason: agentApprovals.reason,
  requestPayload: agentApprovals.requestPayload,
  decisionPayload: agentApprovals.decisionPayload,
  approvedByUserId: agentApprovals.approvedByUserId,
  decidedAt: agentApprovals.decidedAt,
  expiresAt: agentApprovals.expiresAt,
  createdAt: agentApprovals.createdAt,
};

function baseQuery() {
  return db
    .select(approvalSelection)
    .from(agentApprovals)
    .innerJoin(agentExecutions, eq(agentApprovals.executionId, agentExecutions.id))
    .innerJoin(agentTools, eq(agentExecutions.toolId, agentTools.id))
    .leftJoin(requestedByAgents, eq(agentApprovals.requestedByAgentId, requestedByAgents.id))
    .leftJoin(users, eq(agentApprovals.requestedForUserId, users.id));
}

export async function approvalsRoutes(app: FastifyInstance) {
  app.get(
    '/approvals',
    {
      preHandler: [authenticate, requirePermission('agents.approve')],
    },
    async (request, reply) => {
      const query = listApprovalsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, status } = query.data;

      const where = status ? eq(agentApprovals.status, status) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(agentApprovals.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentApprovals).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/approvals/:id/approve',
    {
      preHandler: [authenticate, requirePermission('agents.approve')],
    },
    async (request, reply) => {
      const params = approvalIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = approvalDecisionSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);
      const decision = await approveExecution(params.data.id, userId, body.data.note);

      if (!decision.ok) {
        return reply.code(decision.code === 'not_found' ? 404 : 409).send({
          error: decision.code,
          message: decision.message,
        });
      }

      const outcome = decision.execution;

      if (outcome && (outcome.status === 'failed' || outcome.status === 'rejected')) {
        const agentError = new AgentError(outcome.error!.code, outcome.error!.message);

        return reply.code(agentError.status).send({
          error: agentError.code,
          message: agentError.message,
          executionId: outcome.executionId,
        });
      }

      return reply.code(200).send({
        status: 'approved',
        approvalId: decision.approvalId,
        executionId: outcome?.executionId ?? null,
        result: outcome?.result ?? null,
      });
    },
  );

  app.post(
    '/approvals/:id/reject',
    {
      preHandler: [authenticate, requirePermission('agents.approve')],
    },
    async (request, reply) => {
      const params = approvalIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = approvalDecisionSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);
      const decision = await rejectExecution(params.data.id, userId, body.data.note);

      if (!decision.ok) {
        return reply.code(decision.code === 'not_found' ? 404 : 409).send({
          error: decision.code,
          message: decision.message,
        });
      }

      return reply.code(200).send({
        status: 'rejected',
        approvalId: decision.approvalId,
      });
    },
  );
}
