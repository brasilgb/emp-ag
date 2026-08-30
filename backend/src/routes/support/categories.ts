import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ilike } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { supportCategories } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from '../../schemas/support.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.get(
    '/categories',
    {
      preHandler: [authenticate, requirePermission('support.categories.read')],
    },
    async (request, reply) => {
      const query = listCategoriesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { search, isActive } = query.data;

      const filters = [
        isActive !== undefined ? eq(supportCategories.isActive, isActive) : undefined,
        search ? ilike(supportCategories.name, `%${search}%`) : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const rows = await db
        .select()
        .from(supportCategories)
        .where(where)
        .orderBy(asc(supportCategories.name));

      return { data: rows };
    },
  );

  app.post(
    '/categories',
    {
      preHandler: [authenticate, requirePermission('support.categories.manage')],
    },
    async (request, reply) => {
      const body = createCategorySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select({ id: supportCategories.id })
        .from(supportCategories)
        .where(eq(supportCategories.slug, body.data.slug))
        .limit(1);

      if (existing) {
        return reply.code(409).send({
          error: 'category_slug_taken',
          message: 'Já existe uma categoria com este slug.',
        });
      }

      const userId = currentUserId(request);

      const [category] = await db
        .insert(supportCategories)
        .values({ ...body.data, isSystem: false })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'support.category.created',
        entityType: 'support_category',
        entityId: String(category.id),
        newData: category,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: category });
    },
  );

  app.patch(
    '/categories/:id',
    {
      preHandler: [authenticate, requirePermission('support.categories.manage')],
    },
    async (request, reply) => {
      const params = categoryIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateCategorySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(supportCategories)
        .where(eq(supportCategories.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Categoria não encontrada.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      if (existing.isSystem && body.data.isActive === false) {
        return reply.code(422).send({
          error: 'system_category_locked',
          message: 'Categorias de sistema não podem ser desativadas nesta versão.',
        });
      }

      if (body.data.slug && body.data.slug !== existing.slug) {
        const [slugTaken] = await db
          .select({ id: supportCategories.id })
          .from(supportCategories)
          .where(eq(supportCategories.slug, body.data.slug))
          .limit(1);

        if (slugTaken) {
          return reply.code(409).send({
            error: 'category_slug_taken',
            message: 'Já existe uma categoria com este slug.',
          });
        }
      }

      const userId = currentUserId(request);

      const [updated] = await db
        .update(supportCategories)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(supportCategories.id, params.data.id))
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'support.category.updated',
        entityType: 'support_category',
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
