import type { FastifyInstance } from 'fastify';
import { and, eq, ne, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { financialEntries, financialPayments, projects } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { projectSummaryParamSchema } from '../../schemas/financial.js';

import { badRequest, notFound } from './helpers.js';

// Seção 42: retorna previsto e realizado separadamente ("preferência" do
// próprio documento), sem envelope `data` — mesmo formato "achatado" do
// exemplo JSON da seção.
export async function projectSummaryRoutes(app: FastifyInstance) {
  app.get(
    '/projects/:projectId/summary',
    {
      preHandler: [authenticate, requirePermission('financial.stats.read')],
    },
    async (request, reply) => {
      const params = projectSummaryParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, params.data.projectId))
        .limit(1);

      if (!project) {
        return notFound(reply, 'Projeto não encontrado.');
      }

      const [planned] = await db
        .select({
          plannedIncome: sql<string>`COALESCE(SUM(${financialEntries.amount}) FILTER (WHERE ${financialEntries.type} = 'income'), 0)`,
          plannedExpense: sql<string>`COALESCE(SUM(${financialEntries.amount}) FILTER (WHERE ${financialEntries.type} = 'expense'), 0)`,
        })
        .from(financialEntries)
        .where(
          and(
            eq(financialEntries.projectId, params.data.projectId),
            ne(financialEntries.status, 'cancelled'),
          ),
        );

      const [paid] = await db
        .select({
          paidIncome: sql<string>`COALESCE(SUM(${financialPayments.amount}) FILTER (WHERE ${financialEntries.type} = 'income'), 0)`,
          paidExpense: sql<string>`COALESCE(SUM(${financialPayments.amount}) FILTER (WHERE ${financialEntries.type} = 'expense'), 0)`,
        })
        .from(financialPayments)
        .innerJoin(financialEntries, eq(financialPayments.entryId, financialEntries.id))
        .where(eq(financialEntries.projectId, params.data.projectId));

      const paidIncome = Number(paid.paidIncome);
      const paidExpense = Number(paid.paidExpense);

      return {
        plannedIncome: Number(planned.plannedIncome).toFixed(2),
        plannedExpense: Number(planned.plannedExpense).toFixed(2),
        paidIncome: paidIncome.toFixed(2),
        paidExpense: paidExpense.toFixed(2),
        cashResult: (paidIncome - paidExpense).toFixed(2),
      };
    },
  );
}
