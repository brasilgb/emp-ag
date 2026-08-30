import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentToolPermissions, agentTools, agents } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentIdParamSchema, listAgentToolsQuerySchema } from '../../schemas/agents.js';

import { badRequest, notFound } from './helpers.js';

export async function agentToolsRoutes(app: FastifyInstance) {
  app.get(
    '/tools',
    {
      preHandler: [authenticate, requirePermission('agent.tools.read')],
    },
    async (request, reply) => {
      const query = listAgentToolsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const where = query.data.department ? eq(agentTools.department, query.data.department) : undefined;

      const rows = await db
        .select()
        .from(agentTools)
        .where(where)
        .orderBy(asc(agentTools.department), asc(agentTools.name));

      return { data: rows };
    },
  );

  app.get(
    '/:id/tools',
    {
      preHandler: [authenticate, requirePermission('agent.tools.read')],
    },
    async (request, reply) => {
      const params = agentIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [agent] = await db.select().from(agents).where(eq(agents.id, params.data.id)).limit(1);

      if (!agent) {
        return notFound(reply, 'Agente não encontrado.');
      }

      const rows = await db
        .select({
          id: agentTools.id,
          name: agentTools.name,
          slug: agentTools.slug,
          description: agentTools.description,
          department: agentTools.department,
          autonomyLevel: agentTools.autonomyLevel,
          handler: agentTools.handler,
          isActive: agentTools.isActive,
          isSensitive: agentTools.isSensitive,
          canUse: agentToolPermissions.canUse,
          requiresApprovalOverride: agentToolPermissions.requiresApprovalOverride,
        })
        .from(agentToolPermissions)
        .innerJoin(agentTools, eq(agentToolPermissions.toolId, agentTools.id))
        .where(and(eq(agentToolPermissions.agentId, agent.id), eq(agentToolPermissions.canUse, true)))
        .orderBy(asc(agentTools.name));

      return { data: rows };
    },
  );
}
