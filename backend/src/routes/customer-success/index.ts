import type { FastifyInstance } from 'fastify';

import { accountRoutes } from './accounts.js';
import { activityRoutes } from './activities.js';
import { opportunityRoutes } from './opportunities.js';
import { statsRoutes } from './stats.js';

export async function customerSuccessRoutes(app: FastifyInstance) {
  await app.register(accountRoutes);
  await app.register(activityRoutes);
  await app.register(opportunityRoutes);
  await app.register(statsRoutes);
}
