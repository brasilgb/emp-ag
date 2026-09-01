import type { FastifyInstance } from 'fastify';
import { alias } from 'drizzle-orm/pg-core';
import { and, count, desc, eq, ilike, inArray, isNotNull, lt, not, or } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  clients,
  projects,
  supportCategories,
  supportTickets,
  users,
} from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { publishAgentEvent } from '../../agents/events/publisher.js';
import {
  createTicketSchema,
  listTicketsQuerySchema,
  ticketIdParamSchema,
  updateTicketSchema,
} from '../../schemas/support.js';

import {
  assertProjectBelongsToClient,
  badRequest,
  currentUserId,
  forbidden,
  getCategoryOrNull,
  getClientOrNull,
  getUserPermissionSlugs,
  notFound,
  paginationMeta,
  recordTicketHistory,
  resolveSlaDueAt,
  userExists,
  withOverdue,
} from './helpers.js';

const TERMINAL_STATUSES = ['resolved', 'closed', 'cancelled'] as const;

const ownerUsers = alias(users, 'support_ticket_owner_users');
const openedByUsers = alias(users, 'support_ticket_opened_by_users');

const ticketSelection = {
  id: supportTickets.id,
  clientId: supportTickets.clientId,
  clientName: clients.name,
  projectId: supportTickets.projectId,
  projectName: projects.name,
  categoryId: supportTickets.categoryId,
  categoryName: supportCategories.name,
  title: supportTickets.title,
  description: supportTickets.description,
  status: supportTickets.status,
  priority: supportTickets.priority,
  source: supportTickets.source,
  ownerUserId: supportTickets.ownerUserId,
  ownerName: ownerUsers.name,
  openedByUserId: supportTickets.openedByUserId,
  openedByName: openedByUsers.name,
  firstResponseAt: supportTickets.firstResponseAt,
  resolvedAt: supportTickets.resolvedAt,
  closedAt: supportTickets.closedAt,
  resolution: supportTickets.resolution,
  slaDueAt: supportTickets.slaDueAt,
  createdAt: supportTickets.createdAt,
  updatedAt: supportTickets.updatedAt,
};

function baseQuery() {
  return db
    .select(ticketSelection)
    .from(supportTickets)
    .innerJoin(clients, eq(supportTickets.clientId, clients.id))
    .innerJoin(supportCategories, eq(supportTickets.categoryId, supportCategories.id))
    .leftJoin(projects, eq(supportTickets.projectId, projects.id))
    .leftJoin(ownerUsers, eq(supportTickets.ownerUserId, ownerUsers.id))
    .leftJoin(openedByUsers, eq(supportTickets.openedByUserId, openedByUsers.id));
}

async function getTicketDetail(id: number) {
  const [row] = await baseQuery().where(eq(supportTickets.id, id)).limit(1);
  return row ? withOverdue(row) : null;
}

// Exportada para reuso pela tool support.get_overdue_tickets
// (backend/src/agents/tools/support.ts — seção 22) e pelo filtro
// `overdue` da listagem acima.
export function buildOverdueCondition() {
  return and(
    not(inArray(supportTickets.status, [...TERMINAL_STATUSES])),
    isNotNull(supportTickets.slaDueAt),
    lt(supportTickets.slaDueAt, new Date()),
  );
}

// Reusa a mesma FILTER da rota GET /support/stats (critical = priority
// crítica e ainda não terminal), mas retornando as linhas.
export async function getCriticalTickets() {
  const rows = await baseQuery()
    .where(
      and(
        eq(supportTickets.priority, 'critical'),
        not(inArray(supportTickets.status, [...TERMINAL_STATUSES])),
      ),
    )
    .orderBy(desc(supportTickets.createdAt));

  return rows.map(withOverdue);
}

export async function getOverdueTicketsList() {
  const rows = await baseQuery()
    .where(buildOverdueCondition())
    .orderBy(supportTickets.slaDueAt);

  return rows.map(withOverdue);
}

export async function ticketRoutes(app: FastifyInstance) {
  app.get(
    '/tickets',
    {
      preHandler: [authenticate, requirePermission('support.read')],
    },
    async (request, reply) => {
      const query = listTicketsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const {
        page,
        limit,
        search,
        status,
        priority,
        category,
        client,
        project,
        owner,
        source,
        overdue,
      } = query.data;

      const overdueCondition = buildOverdueCondition();

      const filters = [
        status ? eq(supportTickets.status, status) : undefined,
        priority ? eq(supportTickets.priority, priority) : undefined,
        category ? eq(supportTickets.categoryId, category) : undefined,
        client ? eq(supportTickets.clientId, client) : undefined,
        project ? eq(supportTickets.projectId, project) : undefined,
        owner ? eq(supportTickets.ownerUserId, owner) : undefined,
        source ? eq(supportTickets.source, source) : undefined,
        overdue === true ? overdueCondition : undefined,
        overdue === false ? not(overdueCondition!) : undefined,
        search
          ? or(ilike(supportTickets.title, `%${search}%`), ilike(supportTickets.description, `%${search}%`))
          : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(supportTickets.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(supportTickets).where(where),
      ]);

      return {
        data: rows.map(withOverdue),
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/tickets',
    {
      preHandler: [authenticate, requirePermission('support.create')],
    },
    async (request, reply) => {
      const body = createTicketSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const client = await getClientOrNull(body.data.clientId);

      if (!client) {
        return reply.code(422).send({ error: 'invalid_client', message: 'Cliente inválido ou inexistente.' });
      }

      const category = await getCategoryOrNull(body.data.categoryId);

      if (!category) {
        return reply
          .code(422)
          .send({ error: 'invalid_category', message: 'Categoria inválida ou inexistente.' });
      }

      if (body.data.projectId !== undefined) {
        const coherence = await assertProjectBelongsToClient(body.data.projectId, body.data.clientId);

        if (!coherence.ok) {
          return reply.code(422).send({ error: coherence.code, message: coherence.message });
        }
      }

      const priority = body.data.priority ?? category.defaultPriority;
      const slaDueAt = await resolveSlaDueAt(priority);
      const userId = currentUserId(request);

      const ticket = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(supportTickets)
          .values({
            clientId: body.data.clientId,
            projectId: body.data.projectId ?? null,
            categoryId: body.data.categoryId,
            title: body.data.title,
            description: body.data.description,
            priority,
            source: body.data.source,
            openedByUserId: userId,
            slaDueAt,
          })
          .returning();

        await recordTicketHistory(tx, {
          ticketId: inserted.id,
          actorType: 'user',
          actorId: String(userId),
          event: 'ticket.created',
          newData: inserted,
        });

        // Agentes v1.4 (correio.md seção 9) — mesma transação da criação.
        await publishAgentEvent(
          {
            type: 'support.ticket.created',
            aggregateType: 'support.ticket',
            aggregateId: inserted.id,
            source: 'support.tickets',
            payload: { ticketId: inserted.id, clientId: inserted.clientId, priority: inserted.priority, status: inserted.status, source: inserted.source },
          },
          tx,
        );

        return inserted;
      });

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'support.ticket.created',
        entityType: 'support_ticket',
        entityId: String(ticket.id),
        newData: ticket,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: await getTicketDetail(ticket.id) });
    },
  );

  app.get(
    '/tickets/:id',
    {
      preHandler: [authenticate, requirePermission('support.read')],
    },
    async (request, reply) => {
      const params = ticketIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const ticket = await getTicketDetail(params.data.id);

      if (!ticket) {
        return notFound(reply, 'Chamado não encontrado.');
      }

      return { data: ticket };
    },
  );

  app.patch(
    '/tickets/:id',
    // Sem requirePermission fixo: autorização granular por campo alterado
    // (support.update sempre autoriza; support.assign só quando o body é
    // exclusivamente { ownerUserId }; support.resolve só quando é
    // exclusivamente { status } ou { status, resolution }) — mesmo padrão
    // de PATCH /projects/:id/tasks/:taskId.
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const params = ticketIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateTicketSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Chamado não encontrado.');
      }

      const userId = currentUserId(request);
      const permissionSlugs = await getUserPermissionSlugs(userId);

      const bodyKeys = Object.keys(body.data);
      const isOwnerOnly = bodyKeys.length === 1 && bodyKeys[0] === 'ownerUserId';
      const isStatusOnly =
        bodyKeys.length > 0 &&
        bodyKeys.every((key) => key === 'status' || key === 'resolution') &&
        bodyKeys.includes('status');

      const authorized =
        permissionSlugs.has('support.update') ||
        (isOwnerOnly && permissionSlugs.has('support.assign')) ||
        (isStatusOnly && permissionSlugs.has('support.resolve'));

      if (!authorized) {
        return forbidden(reply);
      }

      if (bodyKeys.length === 0) {
        return { data: await getTicketDetail(existing.id) };
      }

      if (body.data.categoryId !== undefined) {
        const category = await getCategoryOrNull(body.data.categoryId);

        if (!category) {
          return reply
            .code(422)
            .send({ error: 'invalid_category', message: 'Categoria inválida ou inexistente.' });
        }
      }

      const resolvedClientId = body.data.clientId ?? existing.clientId;

      if (body.data.clientId !== undefined) {
        const client = await getClientOrNull(body.data.clientId);

        if (!client) {
          return reply.code(422).send({ error: 'invalid_client', message: 'Cliente inválido ou inexistente.' });
        }
      }

      if (body.data.projectId !== undefined) {
        const coherence = await assertProjectBelongsToClient(body.data.projectId, resolvedClientId);

        if (!coherence.ok) {
          return reply.code(422).send({ error: coherence.code, message: coherence.message });
        }
      }

      if (body.data.ownerUserId !== undefined && !(await userExists(body.data.ownerUserId))) {
        return reply
          .code(422)
          .send({ error: 'invalid_owner', message: 'Responsável inválido ou inexistente.' });
      }

      const statusChanging = body.data.status !== undefined && body.data.status !== existing.status;
      const newStatus = body.data.status;

      if (statusChanging && newStatus === 'closed' && existing.status !== 'resolved') {
        return reply.code(422).send({
          error: 'ticket_not_resolved',
          message: 'Só é possível fechar um chamado que já esteja resolvido (ou cancelá-lo).',
        });
      }

      if (statusChanging && newStatus === 'resolved' && !body.data.resolution && !existing.resolution) {
        return reply.code(422).send({
          error: 'resolution_required',
          message: 'Informe a resolução ao marcar o chamado como resolvido.',
        });
      }

      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(supportTickets)
          .where(eq(supportTickets.id, existing.id))
          .for('update')
          .limit(1);

        const values: Partial<typeof supportTickets.$inferInsert> = {
          ...body.data,
          updatedAt: new Date(),
        };

        const reopening =
          statusChanging &&
          (locked.status === 'resolved' || locked.status === 'closed') &&
          newStatus !== 'resolved' &&
          newStatus !== 'closed';

        if (statusChanging) {
          if (newStatus === 'resolved') {
            values.resolvedAt = new Date();
          } else if (newStatus === 'closed') {
            values.closedAt = new Date();
          } else if (reopening) {
            values.resolvedAt = null;
            values.closedAt = null;
          }
        }

        const [updated] = await tx
          .update(supportTickets)
          .set(values)
          .where(eq(supportTickets.id, existing.id))
          .returning();

        let event = 'ticket.updated';

        if (isOwnerOnly) {
          event = 'ticket.assigned';
        } else if (statusChanging) {
          if (newStatus === 'resolved') event = 'ticket.resolved';
          else if (newStatus === 'closed') event = 'ticket.closed';
          else if (reopening) event = 'ticket.reopened';
          else event = 'ticket.status_changed';
        } else if (bodyKeys.length === 1 && bodyKeys[0] === 'priority') {
          event = 'ticket.priority_changed';
        }

        await recordTicketHistory(tx, {
          ticketId: updated.id,
          actorType: 'user',
          actorId: String(userId),
          event,
          oldData: existing,
          newData: updated,
        });

        // Agentes v1.4 (correio.md seção 9) — mesma transação da
        // alteração. `support.ticket.updated` cobre qualquer PATCH;
        // `support.ticket.closed` é disparado à parte quando o status
        // muda especificamente para 'closed' (evento mais específico).
        await publishAgentEvent(
          {
            type: 'support.ticket.updated',
            aggregateType: 'support.ticket',
            aggregateId: updated.id,
            source: 'support.tickets',
            payload: { ticketId: updated.id, priority: updated.priority, status: updated.status },
          },
          tx,
        );

        if (statusChanging && newStatus === 'closed') {
          await publishAgentEvent(
            {
              type: 'support.ticket.closed',
              aggregateType: 'support.ticket',
              aggregateId: updated.id,
              source: 'support.tickets',
              payload: { ticketId: updated.id, priority: updated.priority },
            },
            tx,
          );
        }

        return { updated, event };
      });

      const auditActionByEvent: Record<string, string> = {
        'ticket.assigned': 'support.ticket.assigned',
        'ticket.resolved': 'support.ticket.resolved',
        'ticket.closed': 'support.ticket.closed',
        'ticket.reopened': 'support.ticket.status_changed',
        'ticket.status_changed': 'support.ticket.status_changed',
        'ticket.priority_changed': 'support.ticket.updated',
        'ticket.updated': 'support.ticket.updated',
      };

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: auditActionByEvent[result.event] ?? 'support.ticket.updated',
        entityType: 'support_ticket',
        entityId: String(result.updated.id),
        oldData: existing,
        newData: result.updated,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return { data: await getTicketDetail(result.updated.id) };
    },
  );
}
