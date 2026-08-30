import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { clients, contacts, crmActivities, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  clientIdParamSchema,
  createActivitySchema,
  createClientSchema,
  createContactSchema,
  listActivitiesQuerySchema,
  listClientsQuerySchema,
  updateClientSchema,
} from '../../schemas/crm.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

export async function clientRoutes(app: FastifyInstance) {
  app.get(
    '/clients',
    {
      preHandler: [authenticate, requirePermission('clients.read')],
    },
    async (request, reply) => {
      const query = listClientsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, search, status, type } = query.data;

      const filters = [
        status ? eq(clients.status, status) : undefined,
        type ? eq(clients.type, type) : undefined,
        search
          ? or(
              ilike(clients.name, `%${search}%`),
              ilike(clients.legalName, `%${search}%`),
              ilike(clients.email, `%${search}%`),
              ilike(clients.document, `%${search}%`),
            )
          : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(clients)
          .where(where)
          .orderBy(desc(clients.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(clients).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/clients',
    {
      preHandler: [authenticate, requirePermission('clients.create')],
    },
    async (request, reply) => {
      const body = createClientSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const [client] = await db
        .insert(clients)
        .values({ ...body.data, createdBy: userId })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'client.created',
        entityType: 'client',
        entityId: String(client.id),
        newData: client,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: client });
    },
  );

  app.get(
    '/clients/:id',
    {
      preHandler: [authenticate, requirePermission('clients.read')],
    },
    async (request, reply) => {
      const params = clientIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.id, params.data.id))
        .limit(1);

      if (!client) {
        return notFound(reply, 'Cliente não encontrado.');
      }

      return { data: client };
    },
  );

  app.patch(
    '/clients/:id',
    {
      preHandler: [authenticate, requirePermission('clients.update')],
    },
    async (request, reply) => {
      const params = clientIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateClientSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(clients)
        .where(eq(clients.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Cliente não encontrado.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      const [updated] = await db
        .update(clients)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(clients.id, params.data.id))
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'client.updated',
        entityType: 'client',
        entityId: String(updated.id),
        oldData: existing,
        newData: updated,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return { data: updated };
    },
  );

  /*
   * Contatos do cliente
   */

  app.get(
    '/clients/:id/contacts',
    {
      preHandler: [authenticate, requirePermission('contacts.read')],
    },
    async (request, reply) => {
      const params = clientIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, params.data.id))
        .limit(1);

      if (!client) {
        return notFound(reply, 'Cliente não encontrado.');
      }

      const rows = await db
        .select()
        .from(contacts)
        .where(eq(contacts.clientId, params.data.id))
        .orderBy(desc(contacts.isPrimary), asc(contacts.name));

      return { data: rows };
    },
  );

  app.post(
    '/clients/:id/contacts',
    {
      preHandler: [authenticate, requirePermission('contacts.create')],
    },
    async (request, reply) => {
      const params = clientIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createContactSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, params.data.id))
        .limit(1);

      if (!client) {
        return notFound(reply, 'Cliente não encontrado.');
      }

      const [contact] = await db
        .insert(contacts)
        .values({ ...body.data, clientId: params.data.id })
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'contact.created',
        entityType: 'contact',
        entityId: String(contact.id),
        newData: contact,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: contact });
    },
  );

  /*
   * Histórico de atividades do cliente
   */

  app.get(
    '/clients/:id/activities',
    {
      preHandler: [authenticate, requirePermission('crm.activities.read')],
    },
    async (request, reply) => {
      const params = clientIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listActivitiesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, params.data.id))
        .limit(1);

      if (!client) {
        return notFound(reply, 'Cliente não encontrado.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select({
            id: crmActivities.id,
            leadId: crmActivities.leadId,
            clientId: crmActivities.clientId,
            userId: crmActivities.userId,
            userName: users.name,
            type: crmActivities.type,
            title: crmActivities.title,
            description: crmActivities.description,
            metadata: crmActivities.metadata,
            occurredAt: crmActivities.occurredAt,
            createdAt: crmActivities.createdAt,
          })
          .from(crmActivities)
          .leftJoin(users, eq(crmActivities.userId, users.id))
          .where(eq(crmActivities.clientId, params.data.id))
          .orderBy(desc(crmActivities.occurredAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(crmActivities)
          .where(eq(crmActivities.clientId, params.data.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/clients/:id/activities',
    {
      preHandler: [authenticate, requirePermission('crm.activities.create')],
    },
    async (request, reply) => {
      const params = clientIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createActivitySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, params.data.id))
        .limit(1);

      if (!client) {
        return notFound(reply, 'Cliente não encontrado.');
      }

      const userId = currentUserId(request);

      const [activity] = await db
        .insert(crmActivities)
        .values({
          ...body.data,
          clientId: params.data.id,
          userId,
          occurredAt: body.data.occurredAt
            ? new Date(body.data.occurredAt)
            : new Date(),
        })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'crm.activity.created',
        entityType: 'crm_activity',
        entityId: String(activity.id),
        newData: activity,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: activity });
    },
  );
}
