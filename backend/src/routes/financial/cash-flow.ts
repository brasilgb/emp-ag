import type { FastifyInstance } from 'fastify';
import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { financialEntries, financialPayments } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { cashFlowQuerySchema } from '../../schemas/financial.js';

import { badRequest } from './helpers.js';

// Seção 22: agregação por dia baseada em pagamentos realizados (não em
// lançamentos previstos), calculada via SQL (GROUP BY date_trunc). Só
// retorna dias com movimento.
export async function cashFlowRoutes(app: FastifyInstance) {
  app.get(
    '/cash-flow',
    {
      preHandler: [authenticate, requirePermission('financial.stats.read')],
    },
    async (request, reply) => {
      const query = cashFlowQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { from, to } = query.data;

      const rows = await db
        .select({
          date: sql<string>`to_char(${financialPayments.paidAt}::date, 'YYYY-MM-DD')`,
          income: sql<string>`COALESCE(SUM(${financialPayments.amount}) FILTER (WHERE ${financialEntries.type} = 'income'), 0)`,
          expense: sql<string>`COALESCE(SUM(${financialPayments.amount}) FILTER (WHERE ${financialEntries.type} = 'expense'), 0)`,
        })
        .from(financialPayments)
        .innerJoin(financialEntries, eq(financialPayments.entryId, financialEntries.id))
        .where(
          and(
            gte(financialPayments.paidAt, new Date(`${from}T00:00:00.000Z`)),
            lte(financialPayments.paidAt, new Date(`${to}T23:59:59.999Z`)),
          ),
        )
        .groupBy(sql`${financialPayments.paidAt}::date`)
        .orderBy(sql`${financialPayments.paidAt}::date`);

      return {
        data: rows.map((row) => ({
          date: row.date,
          income: Number(row.income).toFixed(2),
          expense: Number(row.expense).toFixed(2),
          balance: (Number(row.income) - Number(row.expense)).toFixed(2),
        })),
      };
    },
  );
}
