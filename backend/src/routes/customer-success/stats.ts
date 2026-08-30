import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { customerSuccessAccounts, customerSuccessOpportunities } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';

// Seção 32: tudo calculado via SQL agregado, nunca carregando contas ou
// oportunidades no Node para contar/somar.
export async function statsRoutes(app: FastifyInstance) {
  app.get(
    '/stats',
    {
      preHandler: [authenticate, requirePermission('cs.stats.read')],
    },
    async () => {
      const [accountStats] = await db
        .select({
          activeAccounts: sql<number>`count(*) filter (where ${customerSuccessAccounts.status} = 'active')`,
          onboarding: sql<number>`count(*) filter (where ${customerSuccessAccounts.status} = 'onboarding')`,
          attention: sql<number>`count(*) filter (where ${customerSuccessAccounts.status} = 'attention')`,
          atRisk: sql<number>`count(*) filter (where ${customerSuccessAccounts.status} = 'at_risk')`,
          followUpsDue: sql<number>`count(*) filter (
            where ${customerSuccessAccounts.nextContactAt} is not null
              and ${customerSuccessAccounts.nextContactAt} <= now()
              and ${customerSuccessAccounts.status} <> 'inactive'
          )`,
          averageHealthScore: sql<string | null>`avg(${customerSuccessAccounts.healthScore})`,
          averageSatisfaction: sql<string | null>`avg(${customerSuccessAccounts.satisfactionScore}) filter (
            where ${customerSuccessAccounts.satisfactionScore} is not null
          )`,
        })
        .from(customerSuccessAccounts);

      const [opportunityStats] = await db
        .select({
          expansionPipelineValue: sql<string>`coalesce(sum(${customerSuccessOpportunities.estimatedValue}) filter (
            where ${customerSuccessOpportunities.status} not in ('won', 'lost')
          ), 0)`,
        })
        .from(customerSuccessOpportunities);

      return {
        activeAccounts: Number(accountStats.activeAccounts),
        onboarding: Number(accountStats.onboarding),
        attention: Number(accountStats.attention),
        atRisk: Number(accountStats.atRisk),
        followUpsDue: Number(accountStats.followUpsDue),
        averageHealthScore: Number(Number(accountStats.averageHealthScore ?? 0).toFixed(1)),
        averageSatisfaction: Number(Number(accountStats.averageSatisfaction ?? 0).toFixed(1)),
        expansionPipelineValue: Number(opportunityStats.expansionPipelineValue).toFixed(2),
      };
    },
  );
}
