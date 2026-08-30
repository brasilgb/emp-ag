import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { contacts } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { contactIdParamSchema, updateContactSchema } from '../../schemas/crm.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

export async function contactRoutes(app: FastifyInstance) {
  app.patch(
    '/contacts/:id',
    {
      preHandler: [authenticate, requirePermission('contacts.update')],
    },
    async (request, reply) => {
      const params = contactIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateContactSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Contato não encontrado.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      const [updated] = await db
        .update(contacts)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(contacts.id, params.data.id))
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'contact.updated',
        entityType: 'contact',
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
