import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { auditLogs } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { listAuditLogsQuerySchema } from '../../agents/audit/schemas.js';

import { badRequest, paginationMeta } from './helpers.js';

/**
 * Agentes v1.6 (correio.md seção 9) — visão de auditoria. `audit_logs` já
 * existe (usado pelo projeto inteiro, não só agentes) — esta rota só
 * expõe leitura paginada e filtrada, nunca escreve. Metadata é JSONB, já
 * legível na resposta (o frontend decide como apresentar — seção 9:
 * "com apresentação legível", responsabilidade de UI, não de backend).
 */
export async function auditRoutes(app: FastifyInstance) {
  app.get(
    '/audit-logs',
    { preHandler: [authenticate, requirePermission('agents.audit.read')] },
    async (request, reply) => {
      const query = listAuditLogsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, action, userId, entityType, entityId, from, to } = query.data;

      const conditions: SQL[] = [];
      if (action) conditions.push(eq(auditLogs.action, action));
      if (userId) conditions.push(eq(auditLogs.userId, userId));
      if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
      if (entityId) conditions.push(eq(auditLogs.entityId, entityId));
      if (from) conditions.push(gte(auditLogs.createdAt, from));
      if (to) conditions.push(lte(auditLogs.createdAt, to));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset((page - 1) * limit),
        db.select({ total: count() }).from(auditLogs).where(where),
      ]);

      return { data: rows, pagination: paginationMeta({ page, limit, total: Number(total) }) };
    },
  );
}
