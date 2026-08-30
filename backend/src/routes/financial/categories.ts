import type { FastifyInstance } from 'fastify';
import { and, asc, eq, ilike } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { financialCategories } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from '../../schemas/financial.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.get(
    '/categories',
    {
      preHandler: [authenticate, requirePermission('financial.categories.read')],
    },
    async (request, reply) => {
      const query = listCategoriesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { search, type, isActive } = query.data;

      const filters = [
        type ? eq(financialCategories.type, type) : undefined,
        isActive !== undefined ? eq(financialCategories.isActive, isActive) : undefined,
        search ? ilike(financialCategories.name, `%${search}%`) : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const rows = await db
        .select()
        .from(financialCategories)
        .where(where)
        .orderBy(asc(financialCategories.name));

      return { data: rows };
    },
  );

  app.post(
    '/categories',
    {
      preHandler: [authenticate, requirePermission('financial.categories.manage')],
    },
    async (request, reply) => {
      const body = createCategorySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select({ id: financialCategories.id })
        .from(financialCategories)
        .where(eq(financialCategories.slug, body.data.slug))
        .limit(1);

      if (existing) {
        return reply.code(409).send({
          error: 'category_slug_taken',
          message: 'Já existe uma categoria com este slug.',
        });
      }

      const userId = currentUserId(request);

      const [category] = await db
        .insert(financialCategories)
        .values({ ...body.data, isSystem: false })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'financial.category.created',
        entityType: 'financial_category',
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
      preHandler: [authenticate, requirePermission('financial.categories.manage')],
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
        .from(financialCategories)
        .where(eq(financialCategories.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Categoria não encontrada.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      // Seção 34: categorias de sistema não podem ser desativadas nesta v1.
      if (existing.isSystem && body.data.isActive === false) {
        return reply.code(422).send({
          error: 'system_category_locked',
          message: 'Categorias de sistema não podem ser desativadas nesta versão.',
        });
      }

      if (body.data.slug && body.data.slug !== existing.slug) {
        const [slugTaken] = await db
          .select({ id: financialCategories.id })
          .from(financialCategories)
          .where(eq(financialCategories.slug, body.data.slug))
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
        .update(financialCategories)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(financialCategories.id, params.data.id))
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'financial.category.updated',
        entityType: 'financial_category',
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
