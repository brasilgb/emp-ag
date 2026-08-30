import type { FastifyInstance } from 'fastify';

import { categoryRoutes } from './categories.js';
import { entryRoutes } from './entries.js';
import { paymentRoutes } from './payments.js';
import { statsRoutes } from './stats.js';
import { cashFlowRoutes } from './cash-flow.js';
import { forecastRoutes } from './forecast.js';
import { projectSummaryRoutes } from './project-summary.js';
import { historyRoutes } from './history.js';

export async function financialRoutes(app: FastifyInstance) {
  await app.register(categoryRoutes);
  await app.register(entryRoutes);
  await app.register(paymentRoutes);
  await app.register(historyRoutes);
  await app.register(statsRoutes);
  await app.register(cashFlowRoutes);
  await app.register(forecastRoutes);
  await app.register(projectSummaryRoutes);
}
