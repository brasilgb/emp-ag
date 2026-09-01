import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentEventRules, agentJobs } from '../../db/schema/index.js';
import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { validateFiltersAgainstEventType } from '../../agents/events/filters.js';
import type { EventFilters } from '../../agents/events/filters.js';
import {
  createEventRuleSchema,
  eventRuleIdParamSchema,
  listEventRulesQuerySchema,
  updateEventRuleSchema,
} from '../../agents/events/schemas.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

/**
 * Agentes v1.4 (correio.md seção 20) — CRUD de Event Rules. `event_type`/
 * `job_id` são imutáveis após a criação nesta versão (mesma decisão já
 * tomada para `agentSlug` em Jobs na v1.3): trocar de evento ou de Job
 * associado é conceitualmente criar outra regra — DELETE + POST, nunca
 * uma edição parcial ambígua.
 */
export async function eventRulesRoutes(app: FastifyInstance) {
  app.post(
    '/event-rules',
    { preHandler: [authenticate, requirePermission('agents.event_rules.create')] },
    async (request, reply) => {
      const body = createEventRuleSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, body.data.jobId)).limit(1);

      if (!job) {
        const agentError = new AgentError('job_not_found', 'Job inexistente.');
        return reply.code(agentError.status).send({ error: agentError.code, message: agentError.message });
      }

      const userId = currentUserId(request);

      const [rule] = await db
        .insert(agentEventRules)
        .values({
          name: body.data.name,
          description: body.data.description ?? null,
          eventType: body.data.eventType,
          eventVersion: body.data.eventVersion,
          jobId: body.data.jobId,
          filters: body.data.filters,
          enabled: body.data.enabled,
          createdBy: userId,
        })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'agent_event_rule.created',
        entityType: 'agent_event_rule',
        entityId: String(rule.id),
        metadata: { eventType: rule.eventType, jobId: rule.jobId },
      });

      return reply.code(201).send({ data: rule });
    },
  );

  app.get(
    '/event-rules',
    { preHandler: [authenticate, requirePermission('agents.event_rules.read')] },
    async (request, reply) => {
      const query = listEventRulesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, eventType, jobId, enabled } = query.data;
      const conditions = [
        eventType ? eq(agentEventRules.eventType, eventType) : undefined,
        jobId ? eq(agentEventRules.jobId, jobId) : undefined,
        enabled !== undefined ? eq(agentEventRules.enabled, enabled) : undefined,
      ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(agentEventRules)
          .where(where)
          .orderBy(desc(agentEventRules.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentEventRules).where(where),
      ]);

      return { data: rows, pagination: paginationMeta({ page, limit, total }) };
    },
  );

  app.get(
    '/event-rules/:id',
    { preHandler: [authenticate, requirePermission('agents.event_rules.read')] },
    async (request, reply) => {
      const params = eventRuleIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [rule] = await db.select().from(agentEventRules).where(eq(agentEventRules.id, params.data.id)).limit(1);

      if (!rule) {
        return notFound(reply, 'Event Rule não encontrada.');
      }

      return { data: rule };
    },
  );

  app.patch(
    '/event-rules/:id',
    { preHandler: [authenticate, requirePermission('agents.event_rules.update')] },
    async (request, reply) => {
      const params = eventRuleIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateEventRuleSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [rule] = await db.select().from(agentEventRules).where(eq(agentEventRules.id, params.data.id)).limit(1);

      if (!rule) {
        return notFound(reply, 'Event Rule não encontrada.');
      }

      if (body.data.filters !== undefined) {
        const errors = validateFiltersAgainstEventType(rule.eventType, body.data.filters as EventFilters);

        if (errors.length > 0) {
          return reply.code(400).send({
            error: 'validation_error',
            message: errors[0].message,
            details: errors,
          });
        }
      }

      const [updated] = await db
        .update(agentEventRules)
        .set({
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          ...(body.data.description !== undefined ? { description: body.data.description } : {}),
          ...(body.data.filters !== undefined ? { filters: body.data.filters } : {}),
          ...(body.data.enabled !== undefined ? { enabled: body.data.enabled } : {}),
          updatedAt: new Date(),
        })
        .where(eq(agentEventRules.id, rule.id))
        .returning();

      const userId = currentUserId(request);

      const auditAction =
        body.data.enabled === undefined
          ? 'agent_event_rule.updated'
          : body.data.enabled
            ? 'agent_event_rule.enabled'
            : 'agent_event_rule.disabled';

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: auditAction,
        entityType: 'agent_event_rule',
        entityId: String(rule.id),
        metadata: { fields: Object.keys(body.data) },
      });

      return { data: updated };
    },
  );

  app.delete(
    '/event-rules/:id',
    { preHandler: [authenticate, requirePermission('agents.event_rules.delete')] },
    async (request, reply) => {
      const params = eventRuleIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [rule] = await db.select().from(agentEventRules).where(eq(agentEventRules.id, params.data.id)).limit(1);

      if (!rule) {
        return notFound(reply, 'Event Rule não encontrada.');
      }

      await db.delete(agentEventRules).where(eq(agentEventRules.id, rule.id));

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'agent_event_rule.deleted',
        entityType: 'agent_event_rule',
        entityId: String(rule.id),
        metadata: { eventType: rule.eventType, jobId: rule.jobId },
      });

      return reply.code(204).send();
    },
  );
}
