import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentExecutions, agentTools, agents, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { executionIdParamSchema, listExecutionsQuerySchema } from '../../schemas/agents.js';

import { badRequest, notFound, paginationMeta } from './helpers.js';

const executionSelection = {
  id: agentExecutions.id,
  agentId: agentExecutions.agentId,
  agentName: agents.name,
  agentSlug: agents.slug,
  userId: agentExecutions.userId,
  userName: users.name,
  conversationId: agentExecutions.conversationId,
  toolId: agentExecutions.toolId,
  toolHandler: agentTools.handler,
  toolName: agentTools.name,
  status: agentExecutions.status,
  autonomyLevel: agentExecutions.autonomyLevel,
  input: agentExecutions.input,
  output: agentExecutions.output,
  error: agentExecutions.error,
  startedAt: agentExecutions.startedAt,
  finishedAt: agentExecutions.finishedAt,
  createdAt: agentExecutions.createdAt,
};

function baseQuery() {
  return db
    .select(executionSelection)
    .from(agentExecutions)
    .innerJoin(agents, eq(agentExecutions.agentId, agents.id))
    .innerJoin(agentTools, eq(agentExecutions.toolId, agentTools.id))
    .leftJoin(users, eq(agentExecutions.userId, users.id));
}

export async function executionsRoutes(app: FastifyInstance) {
  app.get(
    '/executions',
    {
      preHandler: [authenticate, requirePermission('agent.executions.read')],
    },
    async (request, reply) => {
      const query = listExecutionsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, status, agentId } = query.data;

      const filters = [
        status ? eq(agentExecutions.status, status) : undefined,
        agentId ? eq(agentExecutions.agentId, agentId) : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(agentExecutions.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentExecutions).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.get(
    '/executions/:id',
    {
      preHandler: [authenticate, requirePermission('agent.executions.read')],
    },
    async (request, reply) => {
      const params = executionIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [execution] = await baseQuery().where(eq(agentExecutions.id, params.data.id)).limit(1);

      if (!execution) {
        return notFound(reply, 'Execução não encontrada.');
      }

      return { data: execution };
    },
  );
}
