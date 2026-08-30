import type { FastifyInstance } from 'fastify';
import { count, desc, eq, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { financialEntries, financialPayments } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  createPaymentSchema,
  entryIdParamSchema,
  listPaymentsQuerySchema,
} from '../../schemas/financial.js';

import {
  badRequest,
  currentUserId,
  notFound,
  paginationMeta,
  settleEntryPayment,
} from './helpers.js';

export async function paymentRoutes(app: FastifyInstance) {
  app.get(
    '/entries/:id/payments',
    {
      preHandler: [authenticate, requirePermission('financial.read')],
    },
    async (request, reply) => {
      const params = entryIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listPaymentsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const [entry] = await db
        .select({ id: financialEntries.id })
        .from(financialEntries)
        .where(eq(financialEntries.id, params.data.id))
        .limit(1);

      if (!entry) {
        return notFound(reply, 'Lançamento não encontrado.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(financialPayments)
          .where(eq(financialPayments.entryId, params.data.id))
          .orderBy(desc(financialPayments.paidAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(financialPayments)
          .where(eq(financialPayments.entryId, params.data.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/entries/:id/payments',
    {
      preHandler: [authenticate, requirePermission('financial.pay')],
    },
    async (request, reply) => {
      const params = entryIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createPaymentSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      // Transacional (seção 29): trava o lançamento, verifica saldo, insere
      // o pagamento, recalcula total pago e status — tudo antes do commit,
      // para que pagamentos concorrentes nunca ultrapassem o saldo.
      const result = await db.transaction(async (tx) => {
        const [lockedEntry] = await tx
          .select()
          .from(financialEntries)
          .where(eq(financialEntries.id, params.data.id))
          .for('update')
          .limit(1);

        if (!lockedEntry) {
          return { outcome: 'not_found' as const };
        }

        if (lockedEntry.status === 'cancelled') {
          return { outcome: 'cancelled' as const };
        }

        const [{ paid }] = await tx
          .select({
            paid: sql<string>`COALESCE(SUM(${financialPayments.amount}), 0)`,
          })
          .from(financialPayments)
          .where(eq(financialPayments.entryId, params.data.id));

        const remaining = Number(lockedEntry.amount) - Number(paid);

        if (Number(body.data.amount) > remaining) {
          return { outcome: 'exceeds_balance' as const, remaining: remaining.toFixed(2) };
        }

        const [payment] = await tx
          .insert(financialPayments)
          .values({
            entryId: params.data.id,
            amount: body.data.amount,
            paidAt: body.data.paidAt ? new Date(body.data.paidAt) : new Date(),
            paymentMethod: body.data.paymentMethod,
            reference: body.data.reference,
            notes: body.data.notes,
            createdBy: userId,
          })
          .returning();

        const { entry: updatedEntry, becamePaid } = await settleEntryPayment(tx, params.data.id);

        return { outcome: 'ok' as const, payment, entry: updatedEntry, becamePaid };
      });

      if (result.outcome === 'not_found') {
        return notFound(reply, 'Lançamento não encontrado.');
      }

      if (result.outcome === 'cancelled') {
        return reply.code(422).send({
          error: 'entry_cancelled',
          message: 'Não é possível registrar pagamento em um lançamento cancelado.',
        });
      }

      if (result.outcome === 'exceeds_balance') {
        return reply.code(422).send({
          error: 'amount_exceeds_balance',
          message: `Valor do pagamento excede o saldo restante (${result.remaining}).`,
        });
      }

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'financial.payment.created',
        entityType: 'financial_payment',
        entityId: String(result.payment.id),
        newData: result.payment,
        metadata: { entryId: params.data.id },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (result.becamePaid) {
        await audit({
          userId,
          actorType: 'user',
          actorId: String(userId),
          action: 'financial.entry.paid',
          entityType: 'financial_entry',
          entityId: String(result.entry.id),
          newData: result.entry,
          metadata: { entryId: params.data.id },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        });
      }

      return reply.code(201).send({ data: { payment: result.payment, entry: result.entry } });
    },
  );
}
