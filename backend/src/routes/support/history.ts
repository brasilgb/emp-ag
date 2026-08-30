import type { FastifyInstance } from 'fastify';
import { count, desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { supportTicketHistory, supportTickets } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { listHistoryQuerySchema, ticketIdParamSchema } from '../../schemas/support.js';

import { badRequest, notFound, paginationMeta } from './helpers.js';

export async function historyRoutes(app: FastifyInstance) {
  app.get(
    '/tickets/:id/history',
    {
      preHandler: [authenticate, requirePermission('support.read')],
    },
    async (request, reply) => {
      const params = ticketIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listHistoryQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const [ticket] = await db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(eq(supportTickets.id, params.data.id))
        .limit(1);

      if (!ticket) {
        return notFound(reply, 'Chamado não encontrado.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(supportTicketHistory)
          .where(eq(supportTicketHistory.ticketId, params.data.id))
          .orderBy(desc(supportTicketHistory.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(supportTicketHistory)
          .where(eq(supportTicketHistory.ticketId, params.data.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );
}
