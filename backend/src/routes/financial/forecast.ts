import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { clients, financialCategories, financialEntries, projects } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';

import { withComputedBalance, paidAmountExpr } from './helpers.js';

// Seção 23: lançamentos pendentes agrupados por vencimento. Uma única query
// ordenada + agrupamento em JS — não é a agregação pesada que a seção 21
// pede para ir para SQL, é só uma lista de lançamentos pending já limitada
// ao subconjunto relevante.
export async function forecastRoutes(app: FastifyInstance) {
  app.get(
    '/forecast',
    {
      preHandler: [authenticate, requirePermission('financial.stats.read')],
    },
    async () => {
      const rows = await db
        .select({
          id: financialEntries.id,
          type: financialEntries.type,
          categoryName: financialCategories.name,
          clientName: clients.name,
          projectName: projects.name,
          description: financialEntries.description,
          amount: financialEntries.amount,
          status: financialEntries.status,
          dueDate: financialEntries.dueDate,
          paidAmount: paidAmountExpr,
        })
        .from(financialEntries)
        .innerJoin(financialCategories, eq(financialEntries.categoryId, financialCategories.id))
        .leftJoin(clients, eq(financialEntries.clientId, clients.id))
        .leftJoin(projects, eq(financialEntries.projectId, projects.id))
        .where(eq(financialEntries.status, 'pending'))
        .orderBy(asc(financialEntries.dueDate));

      const shaped = rows.map(withComputedBalance);

      const grouped = new Map<string, typeof shaped>();

      for (const entry of shaped) {
        const bucket = grouped.get(entry.dueDate) ?? [];
        bucket.push(entry);
        grouped.set(entry.dueDate, bucket);
      }

      return {
        data: Array.from(grouped.entries()).map(([dueDate, entries]) => ({ dueDate, entries })),
      };
    },
  );
}
