import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentEventDeliveries, agentEvents } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { EVENT_CATALOG, EVENT_TYPES } from '../../agents/events/catalog.js';
import { FILTER_OPERATORS } from '../../agents/events/filters.js';
import { eventIdParamSchema, listEventsQuerySchema } from '../../agents/events/schemas.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v1.4 (correio.md seções 20/24). Nunca aceita criar um evento
 * "manualmente" fora do catálogo por aqui — publicação continua exclusiva
 * de `publishAgentEvent()`, chamada só pelo código de domínio.
 */
export async function eventsRoutes(app: FastifyInstance) {
  app.get(
    '/events/catalog',
    { preHandler: [authenticate, requirePermission('agents.events.read')] },
    async () => {
      const data = EVENT_TYPES.map((type) => {
        const definition = EVENT_CATALOG[type];

        return {
          type: definition.type,
          version: definition.version,
          domain: definition.domain,
          description: definition.description,
          filterableFields: definition.filterableFields,
          operators: FILTER_OPERATORS,
        };
      });

      return { data };
    },
  );

  app.get(
    '/events',
    { preHandler: [authenticate, requirePermission('agents.events.read')] },
    async (request, reply) => {
      const query = listEventsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, status, eventType } = query.data;
      const conditions = [status ? eq(agentEvents.status, status) : undefined, eventType ? eq(agentEvents.eventType, eventType) : undefined].filter(
        (condition): condition is NonNullable<typeof condition> => condition !== undefined,
      );
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(agentEvents)
          .where(where)
          .orderBy(desc(agentEvents.receivedAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentEvents).where(where),
      ]);

      return { data: rows, pagination: paginationMeta({ page, limit, total }) };
    },
  );

  app.get(
    '/events/:id',
    { preHandler: [authenticate, requirePermission('agents.events.read')] },
    async (request, reply) => {
      const params = eventIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [event] = await db.select().from(agentEvents).where(eq(agentEvents.id, params.data.id)).limit(1);

      if (!event) {
        return notFound(reply, 'Evento não encontrado.');
      }

      const deliveries = await db
        .select()
        .from(agentEventDeliveries)
        .where(eq(agentEventDeliveries.eventId, event.id))
        .orderBy(desc(agentEventDeliveries.createdAt));

      return { data: { event, deliveries } };
    },
  );

  app.post(
    '/events/:id/retry',
    { preHandler: [authenticate, requirePermission('agents.events.manage')] },
    async (request, reply) => {
      const params = eventIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [event] = await db.select().from(agentEvents).where(eq(agentEvents.id, params.data.id)).limit(1);

      if (!event) {
        return notFound(reply, 'Evento não encontrado.');
      }

      if (event.status !== 'failed') {
        return reply.code(409).send({
          error: 'conflict',
          message: `Só é possível reprocessar eventos "failed" (status atual: "${event.status}").`,
        });
      }

      // Reagenda o processor — nunca contorna policy/approval/idempotência:
      // as deliveries já criadas (event_id, rule_id) continuam protegendo
      // contra duplicar Run (correio.md seção 12).
      const [updated] = await db
        .update(agentEvents)
        .set({ status: 'pending', nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(agentEvents.id, event.id))
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'agent_event.retry_requested',
        entityType: 'agent_event',
        entityId: String(event.id),
        metadata: { previousStatus: event.status },
      });

      return { data: updated };
    },
  );
}
