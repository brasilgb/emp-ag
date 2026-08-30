import type { FastifyInstance } from 'fastify';
import { asc, count, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { supportMessages, supportTickets } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  createMessageSchema,
  listMessagesQuerySchema,
  ticketIdParamSchema,
} from '../../schemas/support.js';

import {
  badRequest,
  currentUserId,
  notFound,
  paginationMeta,
  recordTicketHistory,
} from './helpers.js';

export interface AddInternalNoteResult {
  ok: boolean;
  message?: typeof supportMessages.$inferSelect;
}

// Núcleo transacional de POST /tickets/:id/messages para o caso
// type='note' + isInternal=true, extraído para reuso pela tool
// support.add_internal_note (backend/src/agents/tools/support.ts —
// seção 22/25). Uma nota interna nunca preenche first_response_at (só
// mensagens type='message' preenchem, ver lógica original abaixo).
export async function addInternalNote(
  ticketId: number,
  content: string,
  actorUserId: number,
  requestMeta?: { ipAddress?: string; userAgent?: string },
): Promise<AddInternalNoteResult> {
  const result = await db.transaction(async (tx) => {
    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticketId))
      .for('update')
      .limit(1);

    if (!ticket) {
      return null;
    }

    const [message] = await tx
      .insert(supportMessages)
      .values({
        ticketId,
        userId: actorUserId,
        type: 'note',
        content,
        isInternal: true,
      })
      .returning();

    await recordTicketHistory(tx, {
      ticketId: ticket.id,
      actorType: 'user',
      actorId: String(actorUserId),
      event: 'ticket.note.created',
      newData: message,
    });

    return { message };
  });

  if (!result) {
    return { ok: false };
  }

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'support.message.created',
    entityType: 'support_message',
    entityId: String(result.message.id),
    newData: result.message,
    metadata: { ticketId },
    ipAddress: requestMeta?.ipAddress,
    userAgent: requestMeta?.userAgent,
  });

  return { ok: true, message: result.message };
}

export async function messageRoutes(app: FastifyInstance) {
  app.get(
    '/tickets/:id/messages',
    {
      preHandler: [authenticate, requirePermission('support.read')],
    },
    async (request, reply) => {
      const params = ticketIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listMessagesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const [ticket] = await db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(eq(supportTickets.id, params.data.id))
        .limit(1);

      if (!ticket) {
        return notFound(reply, 'Chamado não encontrado.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(supportMessages)
          .where(eq(supportMessages.ticketId, params.data.id))
          .orderBy(asc(supportMessages.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(supportMessages)
          .where(eq(supportMessages.ticketId, params.data.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/tickets/:id/messages',
    {
      preHandler: [authenticate, requirePermission('support.message')],
    },
    async (request, reply) => {
      const params = ticketIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createMessageSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const result = await db.transaction(async (tx) => {
        const [ticket] = await tx
          .select()
          .from(supportTickets)
          .where(eq(supportTickets.id, params.data.id))
          .for('update')
          .limit(1);

        if (!ticket) {
          return null;
        }

        const [message] = await tx
          .insert(supportMessages)
          .values({
            ticketId: params.data.id,
            userId,
            type: body.data.type,
            content: body.data.content,
            isInternal: body.data.isInternal,
          })
          .returning();

        // Seção 15: primeira mensagem de atendimento humano (type=message,
        // não note/system) preenche first_response_at — nunca sobrescrita
        // depois.
        let firstResponse = false;

        if (body.data.type === 'message' && !ticket.firstResponseAt) {
          await tx
            .update(supportTickets)
            .set({ firstResponseAt: new Date(), updatedAt: new Date() })
            .where(eq(supportTickets.id, ticket.id));

          firstResponse = true;
        }

        await recordTicketHistory(tx, {
          ticketId: ticket.id,
          actorType: 'user',
          actorId: String(userId),
          event: body.data.isInternal || body.data.type === 'note' ? 'ticket.note.created' : 'ticket.message.created',
          newData: message,
        });

        if (firstResponse) {
          await recordTicketHistory(tx, {
            ticketId: ticket.id,
            actorType: 'user',
            actorId: String(userId),
            event: 'ticket.first_response',
          });
        }

        return { message, firstResponse };
      });

      if (!result) {
        return notFound(reply, 'Chamado não encontrado.');
      }

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'support.message.created',
        entityType: 'support_message',
        entityId: String(result.message.id),
        newData: result.message,
        metadata: { ticketId: params.data.id },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: result.message });
    },
  );
}
