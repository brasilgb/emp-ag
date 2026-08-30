import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agents } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentIdParamSchema } from '../../schemas/agents.js';

import { badRequest, notFound } from './helpers.js';

export async function agentsRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('agents.read')],
    },
    async () => {
      const rows = await db.select().from(agents).orderBy(desc(agents.createdAt));

      return { data: rows };
    },
  );

  app.get(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('agents.read')],
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

      return { data: agent };
    },
  );
}
