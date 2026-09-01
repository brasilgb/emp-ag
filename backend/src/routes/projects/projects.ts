import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  clients,
  projectMilestones,
  projects,
  tasks,
  users,
} from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { publishAgentEvent } from '../../agents/events/publisher.js';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  updateProjectSchema,
} from '../../schemas/projects.js';

import {
  badRequest,
  currentUserId,
  notFound,
  paginationMeta,
  userExists,
} from './helpers.js';

// Exportadas para reuso pelas tools projects.get_overdue_projects /
// projects.get_overdue_tasks / projects.get_blocked_tasks
// (backend/src/agents/tools/projects.ts — seção 22). Mesmos predicados já
// usados em GET /projects/stats acima, mas retornando as linhas (não só a
// contagem), que é o que essas tools precisam expor.
export async function getOverdueProjects() {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      clientId: projects.clientId,
      clientName: clients.name,
      status: projects.status,
      priority: projects.priority,
      dueDate: projects.dueDate,
      ownerName: users.name,
    })
    .from(projects)
    .innerJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(users, eq(projects.ownerUserId, users.id))
    .where(
      sql`${projects.dueDate} < current_date and ${projects.status} not in ('completed', 'cancelled')`,
    )
    .orderBy(projects.dueDate);
}

export async function getOverdueTasks() {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assigneeName: users.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeUserId, users.id))
    .where(
      sql`${tasks.dueDate} < current_date and ${tasks.status} not in ('done', 'cancelled')`,
    )
    .orderBy(tasks.dueDate);
}

export async function getBlockedTasks() {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      assigneeName: users.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeUserId, users.id))
    .where(eq(tasks.status, 'blocked'))
    .orderBy(tasks.dueDate);
}

// Contagens usadas por director.get_business_overview (seção 23) — mesma
// query de GET /projects/stats, apenas o subconjunto necessário ao
// overview.
export async function getProjectsOverviewCounts() {
  const [projectRow] = await db
    .select({
      active: sql<number>`count(*) filter (where ${projects.status} in ('planned', 'in_progress', 'on_hold'))`,
      overdue: sql<number>`count(*) filter (where ${projects.dueDate} < current_date and ${projects.status} not in ('completed', 'cancelled'))`,
    })
    .from(projects);

  return {
    active: Number(projectRow?.active ?? 0),
    overdue: Number(projectRow?.overdue ?? 0),
  };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      preHandler: [authenticate, requirePermission('projects.read')],
    },
    async (request, reply) => {
      const query = listProjectsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, search, status, priority, client, owner } =
        query.data;

      const filters = [
        status ? eq(projects.status, status) : undefined,
        priority ? eq(projects.priority, priority) : undefined,
        client ? eq(projects.clientId, client) : undefined,
        owner ? eq(projects.ownerUserId, owner) : undefined,
        search
          ? or(
              ilike(projects.name, `%${search}%`),
              ilike(projects.description, `%${search}%`),
            )
          : undefined,
      ].filter((filter) => filter !== undefined);

      const where = filters.length ? and(...filters) : undefined;

      const baseQuery = db
        .select({
          id: projects.id,
          clientId: projects.clientId,
          clientName: clients.name,
          name: projects.name,
          status: projects.status,
          priority: projects.priority,
          ownerUserId: projects.ownerUserId,
          ownerName: users.name,
          startDate: projects.startDate,
          dueDate: projects.dueDate,
          completedAt: projects.completedAt,
          progress: projects.progress,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .leftJoin(users, eq(projects.ownerUserId, users.id));

      const [rows, [{ total }]] = await Promise.all([
        baseQuery
          .where(where)
          .orderBy(desc(projects.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(projects)
          .where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  // Registrado antes de "/projects/:id" — Fastify prioriza rotas estáticas
  // sobre rotas com parâmetro, então não há ambiguidade, mas mantemos aqui
  // por clareza.
  app.get(
    '/stats',
    {
      preHandler: [authenticate, requirePermission('projects.read')],
    },
    async () => {
      const [projectRow] = await db
        .select({
          activeProjects: sql<number>`count(*) filter (where ${projects.status} in ('planned', 'in_progress', 'on_hold'))`,
          overdueProjects: sql<number>`count(*) filter (where ${projects.dueDate} < current_date and ${projects.status} not in ('completed', 'cancelled'))`,
        })
        .from(projects);

      const [taskRow] = await db
        .select({
          openTasks: sql<number>`count(*) filter (where ${tasks.status} not in ('done', 'cancelled'))`,
          overdueTasks: sql<number>`count(*) filter (where ${tasks.dueDate} < current_date and ${tasks.status} not in ('done', 'cancelled'))`,
          inReviewTasks: sql<number>`count(*) filter (where ${tasks.status} = 'review')`,
        })
        .from(tasks);

      return {
        data: {
          activeProjects: Number(projectRow?.activeProjects ?? 0),
          overdueProjects: Number(projectRow?.overdueProjects ?? 0),
          openTasks: Number(taskRow?.openTasks ?? 0),
          overdueTasks: Number(taskRow?.overdueTasks ?? 0),
          inReviewTasks: Number(taskRow?.inReviewTasks ?? 0),
        },
      };
    },
  );

  app.post(
    '/',
    {
      preHandler: [authenticate, requirePermission('projects.create')],
    },
    async (request, reply) => {
      const body = createProjectSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, body.data.clientId))
        .limit(1);

      if (!client) {
        return reply.code(422).send({
          error: 'invalid_client',
          message: 'Cliente inválido ou inexistente.',
        });
      }

      if (body.data.ownerUserId && !(await userExists(body.data.ownerUserId))) {
        return reply.code(422).send({
          error: 'invalid_owner',
          message: 'Responsável inválido ou inexistente.',
        });
      }

      const userId = currentUserId(request);

      const [project] = await db
        .insert(projects)
        .values({
          ...body.data,
          progress: 0,
          createdBy: userId,
        })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'project.created',
        entityType: 'project',
        entityId: String(project.id),
        newData: project,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      await publishAgentEvent({
        type: 'project.created',
        aggregateType: 'project',
        aggregateId: project.id,
        source: 'projects',
        payload: { projectId: project.id, clientId: project.clientId, name: project.name, status: project.status, priority: project.priority },
      });

      return reply.code(201).send({ data: project });
    },
  );

  app.get(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('projects.read')],
    },
    async (request, reply) => {
      const params = projectIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [project] = await db
        .select({
          id: projects.id,
          clientId: projects.clientId,
          clientName: clients.name,
          name: projects.name,
          description: projects.description,
          status: projects.status,
          priority: projects.priority,
          ownerUserId: projects.ownerUserId,
          ownerName: users.name,
          startDate: projects.startDate,
          dueDate: projects.dueDate,
          completedAt: projects.completedAt,
          estimatedValue: projects.estimatedValue,
          estimatedHours: projects.estimatedHours,
          progress: projects.progress,
          notes: projects.notes,
          createdBy: projects.createdBy,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .leftJoin(users, eq(projects.ownerUserId, users.id))
        .where(eq(projects.id, params.data.id))
        .limit(1);

      if (!project) {
        return notFound(reply, 'Projeto não encontrado.');
      }

      // 3 queries fixas no total (projeto, milestones, contagem de tarefas
      // por status) — sem N+1.
      const [milestones, taskCountRows] = await Promise.all([
        db
          .select()
          .from(projectMilestones)
          .where(eq(projectMilestones.projectId, project.id))
          .orderBy(projectMilestones.position),
        db
          .select({
            status: tasks.status,
            count: count(),
          })
          .from(tasks)
          .where(eq(tasks.projectId, project.id))
          .groupBy(tasks.status),
      ]);

      const byStatus = Object.fromEntries(
        taskCountRows.map((row) => [row.status, row.count]),
      );

      const total = taskCountRows.reduce((sum, row) => sum + row.count, 0);
      const done = byStatus.done ?? 0;
      const cancelled = byStatus.cancelled ?? 0;

      return {
        data: {
          ...project,
          milestones,
          taskCounts: { total, done, cancelled, byStatus },
        },
      };
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: [authenticate, requirePermission('projects.update')],
    },
    async (request, reply) => {
      const params = projectIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateProjectSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [existing] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, params.data.id))
        .limit(1);

      if (!existing) {
        return notFound(reply, 'Projeto não encontrado.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      if (body.data.clientId !== undefined) {
        const [client] = await db
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.id, body.data.clientId))
          .limit(1);

        if (!client) {
          return reply.code(422).send({
            error: 'invalid_client',
            message: 'Cliente inválido ou inexistente.',
          });
        }
      }

      if (
        body.data.ownerUserId !== undefined &&
        !(await userExists(body.data.ownerUserId))
      ) {
        return reply.code(422).send({
          error: 'invalid_owner',
          message: 'Responsável inválido ou inexistente.',
        });
      }

      const [updated] = await db
        .update(projects)
        .set({ ...body.data, updatedAt: new Date() })
        .where(eq(projects.id, params.data.id))
        .returning();

      const userId = currentUserId(request);
      const statusChanged =
        body.data.status !== undefined && body.data.status !== existing.status;

      // O status do projeto nunca muda sozinho — este PATCH é a única forma
      // explícita de alterá-lo, mesmo que todas as tarefas estejam
      // concluídas.
      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: statusChanged ? 'project.status_changed' : 'project.updated',
        entityType: 'project',
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
