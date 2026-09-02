import type { FastifyInstance } from 'fastify';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { listIncidentsQuerySchema } from '../../agents/incidents/schemas.js';
import { listIncidents } from '../../agents/incidents/service.js';

import { badRequest, paginationMeta } from './helpers.js';

/**
 * Agentes v1.6 (correio.md seção 6) — Incident Center. Nenhuma tabela
 * nova: incidentes são projeções sobre agent_autonomy_blocks,
 * agent_event_deliveries e agent_job_runs (agents/incidents/service.ts).
 */
export async function incidentsRoutes(app: FastifyInstance) {
  app.get(
    '/incidents',
    { preHandler: [authenticate, requirePermission('agents.incidents.read')] },
    async (request, reply) => {
      const query = listIncidentsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, type, jobId, from, to } = query.data;
      const { data, total } = await listIncidents({ page, limit, type, jobId, from, to });

      return { data, pagination: paginationMeta({ page, limit, total }) };
    },
  );
}
