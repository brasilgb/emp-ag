import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { financialEntries, financialPayments } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';

import { todayString } from './helpers.js';

// Seção 21: tudo calculado via SQL agregado (FILTER), nunca carregando
// lançamentos no Node para somar em memória.
//
// Exportada (além de usada pela rota abaixo) para reuso pela tool
// finance.get_summary (backend/src/agents/tools/finance.ts) — seção 22:
// a tool não reimplementa a query, chama esta mesma função.
export async function getFinancialSummary() {
  // v1.1 seção 1: "hoje" vem sempre de todayString() (mesma fonte usada em
  // overdueEntryCondition()/helpers.ts), nunca do CURRENT_DATE do Postgres
  // — uma única fonte de verdade para a regra de vencido em todo o módulo.
  const today = todayString();

  const [balances, monthly] = await Promise.all([
    db
      .select({
        receivablePending: sql<string>`COALESCE(SUM(
          (${financialEntries.amount} - (
            SELECT COALESCE(SUM(${financialPayments.amount}), 0)
            FROM ${financialPayments}
            WHERE ${financialPayments.entryId} = ${financialEntries.id}
          ))
        ) FILTER (WHERE ${financialEntries.type} = 'income' AND ${financialEntries.status} = 'pending'), 0)`,
        payablePending: sql<string>`COALESCE(SUM(
          (${financialEntries.amount} - (
            SELECT COALESCE(SUM(${financialPayments.amount}), 0)
            FROM ${financialPayments}
            WHERE ${financialPayments.entryId} = ${financialEntries.id}
          ))
        ) FILTER (WHERE ${financialEntries.type} = 'expense' AND ${financialEntries.status} = 'pending'), 0)`,
        overdueReceivable: sql<string>`COALESCE(SUM(
          (${financialEntries.amount} - (
            SELECT COALESCE(SUM(${financialPayments.amount}), 0)
            FROM ${financialPayments}
            WHERE ${financialPayments.entryId} = ${financialEntries.id}
          ))
        ) FILTER (WHERE ${financialEntries.type} = 'income' AND ${financialEntries.status} = 'pending' AND ${financialEntries.dueDate} < ${today}), 0)`,
        overduePayable: sql<string>`COALESCE(SUM(
          (${financialEntries.amount} - (
            SELECT COALESCE(SUM(${financialPayments.amount}), 0)
            FROM ${financialPayments}
            WHERE ${financialPayments.entryId} = ${financialEntries.id}
          ))
        ) FILTER (WHERE ${financialEntries.type} = 'expense' AND ${financialEntries.status} = 'pending' AND ${financialEntries.dueDate} < ${today}), 0)`,
      })
      .from(financialEntries),

    db
      .select({
        incomePaidThisMonth: sql<string>`COALESCE(SUM(${financialPayments.amount}) FILTER (
          WHERE ${financialEntries.type} = 'income'
            AND date_trunc('month', ${financialPayments.paidAt}) = date_trunc('month', CURRENT_DATE)
        ), 0)`,
        expensePaidThisMonth: sql<string>`COALESCE(SUM(${financialPayments.amount}) FILTER (
          WHERE ${financialEntries.type} = 'expense'
            AND date_trunc('month', ${financialPayments.paidAt}) = date_trunc('month', CURRENT_DATE)
        ), 0)`,
      })
      .from(financialPayments)
      .innerJoin(financialEntries, eq(financialPayments.entryId, financialEntries.id)),
  ]);

  const incomePaidThisMonth = Number(monthly[0].incomePaidThisMonth);
  const expensePaidThisMonth = Number(monthly[0].expensePaidThisMonth);

  return {
    receivablePending: Number(balances[0].receivablePending).toFixed(2),
    payablePending: Number(balances[0].payablePending).toFixed(2),
    incomePaidThisMonth: incomePaidThisMonth.toFixed(2),
    expensePaidThisMonth: expensePaidThisMonth.toFixed(2),
    resultThisMonth: (incomePaidThisMonth - expensePaidThisMonth).toFixed(2),
    overdueReceivable: Number(balances[0].overdueReceivable).toFixed(2),
    overduePayable: Number(balances[0].overduePayable).toFixed(2),
  };
}

export async function statsRoutes(app: FastifyInstance) {
  app.get(
    '/stats',
    {
      preHandler: [authenticate, requirePermission('financial.stats.read')],
    },
    async () => getFinancialSummary(),
  );
}
