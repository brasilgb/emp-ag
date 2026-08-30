import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { clients, financialCategories, financialEntries, projects } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  createEntrySchema,
  entryIdParamSchema,
  listEntriesQuerySchema,
  updateEntrySchema,
} from '../../schemas/financial.js';

import {
  badRequest,
  currentUserId,
  getCategoryOrNull,
  notFound,
  overdueEntryCondition,
  paginationMeta,
  paidAmountExpr,
  resolveClientProject,
  withComputedBalance,
} from './helpers.js';

const entrySelection = {
  id: financialEntries.id,
  type: financialEntries.type,
  categoryId: financialEntries.categoryId,
  categoryName: financialCategories.name,
  clientId: financialEntries.clientId,
  clientName: clients.name,
  projectId: financialEntries.projectId,
  projectName: projects.name,
  description: financialEntries.description,
  amount: financialEntries.amount,
  status: financialEntries.status,
  issueDate: financialEntries.issueDate,
  dueDate: financialEntries.dueDate,
  paidAt: financialEntries.paidAt,
  competenceDate: financialEntries.competenceDate,
  paymentMethod: financialEntries.paymentMethod,
  reference: financialEntries.reference,
  notes: financialEntries.notes,
  createdBy: financialEntries.createdBy,
  createdAt: financialEntries.createdAt,
  updatedAt: financialEntries.updatedAt,
  paidAmount: paidAmountExpr,
};

function baseQuery() {
  return db
    .select(entrySelection)
    .from(financialEntries)
    .innerJoin(financialCategories, eq(financialEntries.categoryId, financialCategories.id))
    .leftJoin(clients, eq(financialEntries.clientId, clients.id))
    .leftJoin(projects, eq(financialEntries.projectId, projects.id));
}

async function validateCategoryForType(categoryId: number, type: 'income' | 'expense') {
  const category = await getCategoryOrNull(categoryId);

  if (!category) {
    return { ok: false as const, message: 'Categoria inválida ou inexistente.' };
  }

  if (category.type !== 'both' && category.type !== type) {
    return {
      ok: false as const,
      message: `A categoria "${category.name}" não é compatível com lançamentos do tipo "${type}".`,
    };
  }

  return { ok: true as const, category };
}

// Exportada para reuso pelas tools finance.get_overdue_receivables /
// finance.get_overdue_payables (backend/src/agents/tools/finance.ts —
// seção 22). Usa a mesma regra canônica de overdueEntryCondition()
// (helpers.ts) do filtro status=overdue abaixo — v1.1 seção 1 corrigiu a
// divergência que existia aqui (ver nota no relatório da v1.1).
export async function getOverdueEntries(type: 'income' | 'expense') {
  return baseQuery()
    .where(and(eq(financialEntries.type, type), overdueEntryCondition()))
    .orderBy(financialEntries.dueDate)
    .then((rows) => rows.map(withComputedBalance));
}

export async function entryRoutes(app: FastifyInstance) {
  app.get(
    '/entries',
    {
      preHandler: [authenticate, requirePermission('financial.read')],
    },
    async (request, reply) => {
      const query = listEntriesQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const {
        page,
        limit,
        search,
        type,
        status,
        category,
        client,
        project,
        due_from,
        due_to,
        competence_from,
        competence_to,
      } = query.data;

      const statusFilter =
        status === 'overdue'
          ? overdueEntryCondition()
          : status
            ? eq(financialEntries.status, status)
            : undefined;

      const filters = [
        type ? eq(financialEntries.type, type) : undefined,
        statusFilter,
        category ? eq(financialEntries.categoryId, category) : undefined,
        client ? eq(financialEntries.clientId, client) : undefined,
        project ? eq(financialEntries.projectId, project) : undefined,
        due_from ? gte(financialEntries.dueDate, due_from) : undefined,
        due_to ? lte(financialEntries.dueDate, due_to) : undefined,
        competence_from ? gte(financialEntries.competenceDate, competence_from) : undefined,
        competence_to ? lte(financialEntries.competenceDate, competence_to) : undefined,
        search
          ? or(
              ilike(financialEntries.description, `%${search}%`),
              ilike(financialEntries.reference, `%${search}%`),
            )
          : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(financialEntries.dueDate))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(financialEntries).where(where),
      ]);

      return {
        data: rows.map(withComputedBalance),
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/entries',
    {
      preHandler: [authenticate, requirePermission('financial.create')],
    },
    async (request, reply) => {
      const body = createEntrySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const categoryCheck = await validateCategoryForType(body.data.categoryId, body.data.type);

      if (!categoryCheck.ok) {
        return reply.code(422).send({ error: 'invalid_category', message: categoryCheck.message });
      }

      const coherence = await resolveClientProject({
        projectId: body.data.projectId,
        clientId: body.data.clientId,
      });

      if (!coherence.ok) {
        return reply.code(422).send({ error: coherence.code, message: coherence.message });
      }

      const userId = currentUserId(request);

      const [entry] = await db
        .insert(financialEntries)
        .values({
          type: body.data.type,
          categoryId: body.data.categoryId,
          clientId: coherence.clientId,
          projectId: body.data.projectId ?? null,
          description: body.data.description,
          amount: body.data.amount,
          issueDate: body.data.issueDate,
          dueDate: body.data.dueDate,
          competenceDate: body.data.competenceDate,
          paymentMethod: body.data.paymentMethod,
          reference: body.data.reference,
          notes: body.data.notes,
          createdBy: userId,
        })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'financial.entry.created',
        entityType: 'financial_entry',
        entityId: String(entry.id),
        newData: entry,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({
        data: withComputedBalance({ ...entry, paidAmount: '0' }),
      });
    },
  );

  app.get(
    '/entries/:id',
    {
      preHandler: [authenticate, requirePermission('financial.read')],
    },
    async (request, reply) => {
      const params = entryIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [entry] = await baseQuery().where(eq(financialEntries.id, params.data.id)).limit(1);

      if (!entry) {
        return notFound(reply, 'Lançamento não encontrado.');
      }

      return { data: withComputedBalance(entry) };
    },
  );

  app.patch(
    '/entries/:id',
    {
      preHandler: [authenticate, requirePermission('financial.update')],
    },
    async (request, reply) => {
      const params = entryIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateEntrySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(financialEntries)
        .where(eq(financialEntries.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Lançamento não encontrado.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      const mergedType = body.data.type ?? (existing.type as 'income' | 'expense');

      if (body.data.categoryId !== undefined || body.data.type !== undefined) {
        const categoryCheck = await validateCategoryForType(
          body.data.categoryId ?? existing.categoryId,
          mergedType,
        );

        if (!categoryCheck.ok) {
          return reply.code(422).send({ error: 'invalid_category', message: categoryCheck.message });
        }
      }

      let resolvedClientId: number | null | undefined;

      if (body.data.projectId !== undefined || body.data.clientId !== undefined) {
        const coherence = await resolveClientProject({
          projectId: body.data.projectId !== undefined ? body.data.projectId : (existing.projectId ?? undefined),
          clientId: body.data.clientId,
        });

        if (!coherence.ok) {
          return reply.code(422).send({ error: coherence.code, message: coherence.message });
        }

        resolvedClientId = coherence.clientId;
      }

      if (body.data.amount !== undefined) {
        const [{ paidAmount }] = await db
          .select({ paidAmount: paidAmountExpr })
          .from(financialEntries)
          .where(eq(financialEntries.id, params.data.id))
          .limit(1);

        if (Number(body.data.amount) < Number(paidAmount)) {
          return reply.code(422).send({
            error: 'amount_below_paid',
            message: 'O novo valor não pode ser menor que o total já pago.',
          });
        }
      }

      const userId = currentUserId(request);

      const [updated] = await db
        .update(financialEntries)
        .set({
          ...body.data,
          clientId: resolvedClientId !== undefined ? resolvedClientId : undefined,
          updatedAt: new Date(),
        })
        .where(eq(financialEntries.id, params.data.id))
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'financial.entry.updated',
        entityType: 'financial_entry',
        entityId: String(updated.id),
        oldData: existing,
        newData: updated,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      const [detail] = await baseQuery().where(eq(financialEntries.id, updated.id)).limit(1);

      return { data: withComputedBalance(detail) };
    },
  );
}
