import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentConversations, agentMessages } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import {
  conversationIdParamSchema,
  createConversationMessageSchema,
  createConversationSchema,
  listConversationsQuerySchema,
} from '../../schemas/agents.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

// Uma conversa só é visível/editável pelo próprio usuário — mesmo padrão
// de não vazar existência de registro de outro usuário usado em outros
// módulos (notFound em vez de forbidden).
async function getOwnConversationOrNull(id: number, userId: number) {
  const [conversation] = await db
    .select()
    .from(agentConversations)
    .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, userId)))
    .limit(1);

  return conversation;
}

export async function conversationsRoutes(app: FastifyInstance) {
  app.get(
    '/conversations',
    {
      preHandler: [authenticate, requirePermission('agents.use')],
    },
    async (request, reply) => {
      const query = listConversationsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit } = query.data;
      const userId = currentUserId(request);
      const where = eq(agentConversations.userId, userId);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(agentConversations)
          .where(where)
          .orderBy(desc(agentConversations.updatedAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentConversations).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/conversations',
    {
      preHandler: [authenticate, requirePermission('agents.use')],
    },
    async (request, reply) => {
      const body = createConversationSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const [conversation] = await db
        .insert(agentConversations)
        .values({
          userId,
          title: body.data.title ?? null,
        })
        .returning();

      return reply.code(201).send({ data: conversation });
    },
  );

  app.get(
    '/conversations/:id',
    {
      preHandler: [authenticate, requirePermission('agents.use')],
    },
    async (request, reply) => {
      const params = conversationIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const userId = currentUserId(request);
      const conversation = await getOwnConversationOrNull(params.data.id, userId);

      if (!conversation) {
        return notFound(reply, 'Conversa não encontrada.');
      }

      const messages = await db
        .select()
        .from(agentMessages)
        .where(eq(agentMessages.conversationId, conversation.id))
        .orderBy(asc(agentMessages.createdAt));

      return { data: { ...conversation, messages } };
    },
  );

  // Anexa uma mensagem de usuário "crua" à conversa, sem disparar o
  // pipeline de execução (isso é responsabilidade exclusiva de
  // POST /agents/chat — seção 32/33).
  app.post(
    '/conversations/:id/messages',
    {
      preHandler: [authenticate, requirePermission('agents.use')],
    },
    async (request, reply) => {
      const params = conversationIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createConversationMessageSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);
      const conversation = await getOwnConversationOrNull(params.data.id, userId);

      if (!conversation) {
        return notFound(reply, 'Conversa não encontrada.');
      }

      const [message] = await db
        .insert(agentMessages)
        .values({
          conversationId: conversation.id,
          role: 'user',
          content: body.data.content,
        })
        .returning();

      await db
        .update(agentConversations)
        .set({ updatedAt: new Date() })
        .where(eq(agentConversations.id, conversation.id));

      return reply.code(201).send({ data: message });
    },
  );
}
