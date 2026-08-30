import type { FastifyInstance } from 'fastify';

import { milestoneRoutes } from './milestones.js';
import { projectRoutes } from './projects.js';
import { taskRoutes } from './tasks.js';

export async function projectsRoutes(app: FastifyInstance) {
  await app.register(projectRoutes);
  await app.register(milestoneRoutes);
  await app.register(taskRoutes);
}
