import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { supportTickets } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';

// Seção 21: tudo calculado via SQL agregado (FILTER), nunca carregando
// tickets no Node para contar/somar.
async function getFullStats() {
  const [counts] = await db
    .select({
      open: sql<number>`count(*) filter (where ${supportTickets.status} = 'open')`,
      inProgress: sql<number>`count(*) filter (where ${supportTickets.status} = 'in_progress')`,
      waitingCustomer: sql<number>`count(*) filter (where ${supportTickets.status} = 'waiting_customer')`,
      critical: sql<number>`count(*) filter (
        where ${supportTickets.priority} = 'critical'
          and ${supportTickets.status} not in ('resolved', 'closed', 'cancelled')
      )`,
      overdue: sql<number>`count(*) filter (
        where ${supportTickets.status} not in ('resolved', 'closed', 'cancelled')
          and ${supportTickets.slaDueAt} is not null
          and ${supportTickets.slaDueAt} < now()
      )`,
      resolvedThisMonth: sql<number>`count(*) filter (
        where ${supportTickets.resolvedAt} is not null
          and date_trunc('month', ${supportTickets.resolvedAt}) = date_trunc('month', current_date)
      )`,
    })
    .from(supportTickets);

  const [averages] = await db
    .select({
      averageFirstResponseMinutes: sql<string | null>`avg(
        extract(epoch from (${supportTickets.firstResponseAt} - ${supportTickets.createdAt})) / 60
      ) filter (where ${supportTickets.firstResponseAt} is not null)`,
      averageResolutionMinutes: sql<string | null>`avg(
        extract(epoch from (${supportTickets.resolvedAt} - ${supportTickets.createdAt})) / 60
      ) filter (where ${supportTickets.resolvedAt} is not null)`,
    })
    .from(supportTickets);

  return {
    open: Number(counts.open),
    inProgress: Number(counts.inProgress),
    waitingCustomer: Number(counts.waitingCustomer),
    critical: Number(counts.critical),
    overdue: Number(counts.overdue),
    resolvedThisMonth: Number(counts.resolvedThisMonth),
    averageFirstResponseMinutes: Math.round(Number(averages.averageFirstResponseMinutes ?? 0)),
    averageResolutionMinutes: Math.round(Number(averages.averageResolutionMinutes ?? 0)),
  };
}

// Exportada para reuso por director.get_business_overview
// (backend/src/agents/tools/director.ts — seção 22/23): apenas o
// subconjunto de contagens que o overview precisa.
export async function getSupportOverviewCounts() {
  const stats = await getFullStats();

  return {
    open: stats.open,
    critical: stats.critical,
    overdue: stats.overdue,
  };
}

export async function statsRoutes(app: FastifyInstance) {
  app.get(
    '/stats',
    {
      preHandler: [authenticate, requirePermission('support.stats.read')],
    },
    async () => getFullStats(),
  );
}
