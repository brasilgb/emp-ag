import type { FastifyInstance } from 'fastify';
import { count, desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { customerSuccessAccounts, customerSuccessActivities } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  accountIdParamSchema,
  createActivitySchema,
  listActivitiesQuerySchema,
} from '../../schemas/customer-success.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

export interface CreateFollowupActivityInput {
  type: string;
  title: string;
  description?: string;
  metadata?: unknown;
  occurredAt?: string;
}

export interface CreateFollowupActivityResult {
  ok: boolean;
  activity?: typeof customerSuccessActivities.$inferSelect;
}

// Núcleo transacional de POST /accounts/:id/activities, extraído para
// reuso pela tool cs.create_internal_followup_activity
// (backend/src/agents/tools/cs.ts — seção 22/25). Trava a conta, insere a
// atividade e atualiza last_contact_at na mesma transação (seção 36) —
// qualquer atividade registrada conta como um contato com o cliente,
// inclusive quando registrada por um agente.
export async function createFollowupActivity(
  accountId: number,
  input: CreateFollowupActivityInput,
  actorUserId: number,
  requestMeta?: { ipAddress?: string; userAgent?: string },
): Promise<CreateFollowupActivityResult> {
  const result = await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(customerSuccessAccounts)
      .where(eq(customerSuccessAccounts.id, accountId))
      .for('update')
      .limit(1);

    if (!account) {
      return null;
    }

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

    const [activity] = await tx
      .insert(customerSuccessActivities)
      .values({
        csAccountId: account.id,
        userId: actorUserId,
        type: input.type,
        title: input.title,
        description: input.description,
        metadata: input.metadata,
        occurredAt,
      })
      .returning();

    await tx
      .update(customerSuccessAccounts)
      .set({ lastContactAt: occurredAt, updatedAt: new Date() })
      .where(eq(customerSuccessAccounts.id, account.id));

    return activity;
  });

  if (!result) {
    return { ok: false };
  }

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'cs.activity.created',
    entityType: 'customer_success_activity',
    entityId: String(result.id),
    newData: result,
    metadata: { csAccountId: accountId },
    ipAddress: requestMeta?.ipAddress,
    userAgent: requestMeta?.userAgent,
  });

  return { ok: true, activity: result };
}

export async function activityRoutes(app: FastifyInstance) {
  app.get(
    '/accounts/:id/activities',
    {
      preHandler: [authenticate, requirePermission('cs.activities.read')],
    },
    async (request, reply) => {
      const params = accountIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listActivitiesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const [account] = await db
        .select({ id: customerSuccessAccounts.id })
        .from(customerSuccessAccounts)
        .where(eq(customerSuccessAccounts.id, params.data.id))
        .limit(1);

      if (!account) {
        return notFound(reply, 'Conta de Customer Success não encontrada.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(customerSuccessActivities)
          .where(eq(customerSuccessActivities.csAccountId, params.data.id))
          .orderBy(desc(customerSuccessActivities.occurredAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(customerSuccessActivities)
          .where(eq(customerSuccessActivities.csAccountId, params.data.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/accounts/:id/activities',
    {
      preHandler: [authenticate, requirePermission('cs.activities.create')],
    },
    async (request, reply) => {
      const params = accountIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createActivitySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const result = await createFollowupActivity(params.data.id, body.data, userId, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result.ok) {
        return notFound(reply, 'Conta de Customer Success não encontrada.');
      }

      return reply.code(201).send({ data: result.activity });
    },
  );
}
