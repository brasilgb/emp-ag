import type { FastifyInstance } from 'fastify';

import { clientRoutes } from './clients.js';
import { contactRoutes } from './contacts.js';
import { leadRoutes } from './leads.js';
import { pipelineRoutes } from './pipeline.js';

export async function crmRoutes(app: FastifyInstance) {
  await app.register(clientRoutes);
  await app.register(contactRoutes);
  await app.register(leadRoutes);
  await app.register(pipelineRoutes);
}
