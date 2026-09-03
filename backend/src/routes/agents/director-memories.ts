import type { FastifyInstance } from 'fastify';

import { db } from '../../db/index.js';
import { agentExecutiveReviews } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { createStrategicMemoryFromReview, getStrategicMemoryById, listStrategicMemories } from '../../agents/director/memory/memory-service.js';
import { listStrategicMemoriesQuerySchema, memoryIdParamSchema, reviewIdParamSchema } from '../../agents/director/memory/schemas-route.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v2.3 (correio.md seção 18) — Strategic Memory API mínima:
 * criar (a partir de uma Executive Review), consultar, listar. Nenhum
 * CRUD administrativo grande — arquivar continua só como função de
 * serviço (`archiveStrategicMemory`), sem rota própria nesta versão
 * (ver `executed.md`, seção de pendências).
 *
 * Permissions reaproveitadas (seção 17: "não criar permission nova"):
 * leitura em `agents.read`, criação em
 * `agents.director.initiatives.manage` (mesma permission já usada por
 * `POST .../review` na v2.2 — é uma ação administrativa sobre o mesmo
 * domínio do Diretor).
 */
export async function directorMemoriesRoutes(app: FastifyInstance) {
  app.get(
    '/director/memories',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const query = listStrategicMemoriesQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listStrategicMemories(query.data);
      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/director/memories/:id',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const params = memoryIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const memory = await getStrategicMemoryById(params.data.id);
      if (!memory || memory.status === 'draft') return notFound(reply, 'Memória estratégica não encontrada.');

      return { data: memory };
    },
  );

  app.post(
    '/director/reviews/:id/memory',
    { preHandler: [authenticate, requirePermission('agents.director.initiatives.manage')] },
    async (request, reply) => {
      const params = reviewIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const [review] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, params.data.id)).limit(1);
      if (!review || review.status === 'draft') return notFound(reply, 'Executive Review não encontrada.');

      try {
        const result = await createStrategicMemoryFromReview(review, currentUserId(request));
        // 201 só quando uma memória nova foi de fato gerada (mesmo
        // padrão de `.../review`: chamada idempotente devolvendo a
        // memória existente é 200, nunca um segundo "created").
        return reply.code(result.created ? 201 : 200).send({ data: result.memory });
      } catch (error) {
        if (error instanceof AgentError) {
          return reply.code(error.status).send({ error: error.code, message: error.message, details: error.details });
        }
        throw error;
      }
    },
  );
}
