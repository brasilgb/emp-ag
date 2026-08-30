import type { FastifyInstance } from 'fastify';

import { categoryRoutes } from './categories.js';
import { ticketRoutes } from './tickets.js';
import { messageRoutes } from './messages.js';
import { historyRoutes } from './history.js';
import { statsRoutes } from './stats.js';

export async function supportRoutes(app: FastifyInstance) {
  await app.register(categoryRoutes);
  await app.register(ticketRoutes);
  await app.register(messageRoutes);
  await app.register(historyRoutes);
  await app.register(statsRoutes);
}
