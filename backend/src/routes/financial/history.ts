import type { FastifyInstance } from 'fastify';
import { and, desc, eq, or, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { auditLogs, financialEntries, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { entryIdParamSchema } from '../../schemas/financial.js';

import { badRequest, notFound } from './helpers.js';

// Seção 27 ("histórico/auditoria" no detalhe do lançamento). Não existe
// hoje um endpoint de leitura de auditoria genérico no projeto — esta rota
// é deliberadamente estreita, só para o próprio lançamento e seus
// pagamentos (correlacionados via metadata->>'entryId', gravado em
// routes/financial/payments.ts a cada audit() de pagamento).
export async function historyRoutes(app: FastifyInstance) {
  app.get(
    '/entries/:id/history',
    {
      preHandler: [authenticate, requirePermission('financial.read')],
    },
    async (request, reply) => {
      const params = entryIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [entry] = await db
        .select({ id: financialEntries.id })
        .from(financialEntries)
        .where(eq(financialEntries.id, params.data.id))
        .limit(1);

      if (!entry) {
        return notFound(reply, 'Lançamento não encontrado.');
      }

      const rows = await db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          userId: auditLogs.userId,
          userName: users.name,
          oldData: auditLogs.oldData,
          newData: auditLogs.newData,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.userId, users.id))
        .where(
          or(
            and(eq(auditLogs.entityType, 'financial_entry'), eq(auditLogs.entityId, String(params.data.id))),
            and(
              eq(auditLogs.entityType, 'financial_payment'),
              sql`${auditLogs.metadata} ->> 'entryId' = ${String(params.data.id)}`,
            ),
          ),
        )
        .orderBy(desc(auditLogs.createdAt));

      return { data: rows };
    },
  );
}
