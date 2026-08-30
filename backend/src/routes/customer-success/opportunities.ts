import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, notInArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { clients, customerSuccessOpportunities, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityIdParamSchema,
  updateOpportunitySchema,
} from '../../schemas/customer-success.js';

import {
  badRequest,
  currentUserId,
  ensureCsAccount,
  getClientOrNull,
  notFound,
  paginationMeta,
  userExists,
} from './helpers.js';

const opportunitySelection = {
  id: customerSuccessOpportunities.id,
  clientId: customerSuccessOpportunities.clientId,
  clientName: clients.name,
  csAccountId: customerSuccessOpportunities.csAccountId,
  type: customerSuccessOpportunities.type,
  title: customerSuccessOpportunities.title,
  description: customerSuccessOpportunities.description,
  estimatedValue: customerSuccessOpportunities.estimatedValue,
  status: customerSuccessOpportunities.status,
  ownerUserId: customerSuccessOpportunities.ownerUserId,
  ownerName: users.name,
  createdAt: customerSuccessOpportunities.createdAt,
  updatedAt: customerSuccessOpportunities.updatedAt,
};

function baseQuery() {
  return db
    .select(opportunitySelection)
    .from(customerSuccessOpportunities)
    .innerJoin(clients, eq(customerSuccessOpportunities.clientId, clients.id))
    .leftJoin(users, eq(customerSuccessOpportunities.ownerUserId, users.id));
}

// Exportada para reuso pela tool cs.get_expansion_opportunities
// (backend/src/agents/tools/cs.ts — seção 22). Mesmo predicado usado em
// GET /customer-success/stats (expansionPipelineValue).
export async function getExpansionOpportunities() {
  return baseQuery()
    .where(notInArray(customerSuccessOpportunities.status, ['won', 'lost']))
    .orderBy(desc(customerSuccessOpportunities.estimatedValue));
}

export async function opportunityRoutes(app: FastifyInstance) {
  app.get(
    '/opportunities',
    {
      preHandler: [authenticate, requirePermission('cs.opportunities.read')],
    },
    async (request, reply) => {
      const query = listOpportunitiesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, status, type, client, owner } = query.data;

      const filters = [
        status ? eq(customerSuccessOpportunities.status, status) : undefined,
        type ? eq(customerSuccessOpportunities.type, type) : undefined,
        client ? eq(customerSuccessOpportunities.clientId, client) : undefined,
        owner ? eq(customerSuccessOpportunities.ownerUserId, owner) : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(customerSuccessOpportunities.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(customerSuccessOpportunities).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/opportunities',
    {
      preHandler: [authenticate, requirePermission('cs.opportunities.create')],
    },
    async (request, reply) => {
      const body = createOpportunitySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const client = await getClientOrNull(body.data.clientId);

      if (!client) {
        return reply.code(422).send({ error: 'invalid_client', message: 'Cliente inválido ou inexistente.' });
      }

      if (body.data.ownerUserId !== undefined && !(await userExists(body.data.ownerUserId))) {
        return reply
          .code(422)
          .send({ error: 'invalid_owner', message: 'Responsável inválido ou inexistente.' });
      }

      const userId = currentUserId(request);

      // Garante a conta CS do cliente antes de vincular (seção 31) — sem
      // exigir que ela já exista.
      const opportunity = await db.transaction(async (tx) => {
        const { account } = await ensureCsAccount(tx, body.data.clientId);

        const [inserted] = await tx
          .insert(customerSuccessOpportunities)
          .values({
            clientId: body.data.clientId,
            csAccountId: account.id,
            type: body.data.type,
            title: body.data.title,
            description: body.data.description,
            estimatedValue: body.data.estimatedValue,
            ownerUserId: body.data.ownerUserId,
          })
          .returning();

        return inserted;
      });

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'cs.opportunity.created',
        entityType: 'customer_success_opportunity',
        entityId: String(opportunity.id),
        newData: opportunity,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      const [detail] = await baseQuery()
        .where(eq(customerSuccessOpportunities.id, opportunity.id))
        .limit(1);

      return reply.code(201).send({ data: detail });
    },
  );

  app.patch(
    '/opportunities/:id',
    {
      preHandler: [authenticate, requirePermission('cs.opportunities.update')],
    },
    async (request, reply) => {
      const params = opportunityIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateOpportunitySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(customerSuccessOpportunities)
        .where(eq(customerSuccessOpportunities.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Oportunidade não encontrada.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      if (body.data.ownerUserId !== undefined && !(await userExists(body.data.ownerUserId))) {
        return reply
          .code(422)
          .send({ error: 'invalid_owner', message: 'Responsável inválido ou inexistente.' });
      }

      const userId = currentUserId(request);

      const [updated] = await db
        .update(customerSuccessOpportunities)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(customerSuccessOpportunities.id, params.data.id))
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'cs.opportunity.updated',
        entityType: 'customer_success_opportunity',
        entityId: String(updated.id),
        oldData: existing,
        newData: updated,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      const [detail] = await baseQuery().where(eq(customerSuccessOpportunities.id, updated.id)).limit(1);

      return { data: detail };
    },
  );
}
