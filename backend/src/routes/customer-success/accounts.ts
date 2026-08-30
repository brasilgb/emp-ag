import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, ilike, lte, ne } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { clients, customerSuccessAccounts, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  accountIdParamSchema,
  createCsAccountSchema,
  listAccountsQuerySchema,
  updateCsAccountSchema,
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

const accountSelection = {
  id: customerSuccessAccounts.id,
  clientId: customerSuccessAccounts.clientId,
  clientName: clients.name,
  ownerUserId: customerSuccessAccounts.ownerUserId,
  ownerName: users.name,
  status: customerSuccessAccounts.status,
  healthScore: customerSuccessAccounts.healthScore,
  onboardingStatus: customerSuccessAccounts.onboardingStatus,
  lastContactAt: customerSuccessAccounts.lastContactAt,
  nextContactAt: customerSuccessAccounts.nextContactAt,
  satisfactionScore: customerSuccessAccounts.satisfactionScore,
  churnRisk: customerSuccessAccounts.churnRisk,
  notes: customerSuccessAccounts.notes,
  createdAt: customerSuccessAccounts.createdAt,
  updatedAt: customerSuccessAccounts.updatedAt,
};

function baseQuery() {
  return db
    .select(accountSelection)
    .from(customerSuccessAccounts)
    .innerJoin(clients, eq(customerSuccessAccounts.clientId, clients.id))
    .leftJoin(users, eq(customerSuccessAccounts.ownerUserId, users.id));
}

// Exportadas para reuso pelas tools cs.get_at_risk_accounts /
// cs.get_due_followups (backend/src/agents/tools/cs.ts — seção 22).
// Mesmos predicados usados em GET /customer-success/stats.
export async function getAtRiskAccounts() {
  return baseQuery()
    .where(eq(customerSuccessAccounts.status, 'at_risk'))
    .orderBy(customerSuccessAccounts.healthScore);
}

export async function getDueFollowups() {
  return baseQuery()
    .where(
      and(
        lte(customerSuccessAccounts.nextContactAt, new Date()),
        ne(customerSuccessAccounts.status, 'inactive'),
      ),
    )
    .orderBy(customerSuccessAccounts.nextContactAt);
}

export async function accountRoutes(app: FastifyInstance) {
  app.get(
    '/accounts',
    {
      preHandler: [authenticate, requirePermission('cs.read')],
    },
    async (request, reply) => {
      const query = listAccountsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, search, status, churnRisk, owner } = query.data;

      const filters = [
        status ? eq(customerSuccessAccounts.status, status) : undefined,
        churnRisk ? eq(customerSuccessAccounts.churnRisk, churnRisk) : undefined,
        owner ? eq(customerSuccessAccounts.ownerUserId, owner) : undefined,
        search ? ilike(clients.name, `%${search}%`) : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(customerSuccessAccounts.updatedAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(customerSuccessAccounts)
          .innerJoin(clients, eq(customerSuccessAccounts.clientId, clients.id))
          .where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  // Seção 31: criação/garantia idempotente de conta CS sob demanda — não é
  // disparada automaticamente ao criar um cliente no CRM.
  app.post(
    '/accounts',
    {
      preHandler: [authenticate, requirePermission('cs.update')],
    },
    async (request, reply) => {
      const body = createCsAccountSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const client = await getClientOrNull(body.data.clientId);

      if (!client) {
        return reply.code(422).send({ error: 'invalid_client', message: 'Cliente inválido ou inexistente.' });
      }

      const userId = currentUserId(request);

      const { account, created } = await db.transaction((tx) => ensureCsAccount(tx, body.data.clientId));

      if (created) {
        await audit({
          userId,
          actorType: 'user',
          actorId: String(userId),
          action: 'cs.account.updated',
          entityType: 'customer_success_account',
          entityId: String(account.id),
          newData: account,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
      }

      return reply.code(created ? 201 : 200).send({ data: account });
    },
  );

  app.get(
    '/accounts/:id',
    {
      preHandler: [authenticate, requirePermission('cs.read')],
    },
    async (request, reply) => {
      const params = accountIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [account] = await baseQuery().where(eq(customerSuccessAccounts.id, params.data.id)).limit(1);

      if (!account) {
        return notFound(reply, 'Conta de Customer Success não encontrada.');
      }

      return { data: account };
    },
  );

  app.patch(
    '/accounts/:id',
    {
      preHandler: [authenticate, requirePermission('cs.update')],
    },
    async (request, reply) => {
      const params = accountIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateCsAccountSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(customerSuccessAccounts)
        .where(eq(customerSuccessAccounts.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Conta de Customer Success não encontrada.');
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
        .update(customerSuccessAccounts)
        .set({
          ...body.data,
          lastContactAt: body.data.lastContactAt !== undefined ? new Date(body.data.lastContactAt) : undefined,
          nextContactAt: body.data.nextContactAt !== undefined ? new Date(body.data.nextContactAt) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(customerSuccessAccounts.id, params.data.id))
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'cs.account.updated',
        entityType: 'customer_success_account',
        entityId: String(updated.id),
        oldData: existing,
        newData: updated,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return { data: updated };
    },
  );
}
