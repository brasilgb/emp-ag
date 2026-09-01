import type { FastifyInstance } from 'fastify';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  or,
  sql,
} from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';

import { db } from '../../db/index.js';
import {
  auditLogs,
  projectMilestones,
  taskComments,
  taskHistory,
  tasks,
  users,
} from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import { publishAgentEvent } from '../../agents/events/publisher.js';
import {
  createCommentSchema,
  createTaskSchema,
  listCommentsQuerySchema,
  listHistoryQuerySchema,
  listTasksQuerySchema,
  projectIdParamSchema,
  taskParamSchema,
  updateTaskSchema,
} from '../../schemas/projects.js';

import {
  badRequest,
  currentUserId,
  getMilestoneInProject,
  getProjectOrNull,
  getUserPermissionSlugs,
  notFound,
  paginationMeta,
  recalcProjectProgress,
  userExists,
} from './helpers.js';

// Ordem fixa das colunas do board — todas sempre presentes, mesmo vazias,
// para o board não mudar de estrutura dependendo dos dados existentes.
const BOARD_COLUMNS: Array<{ status: string; label: string }> = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'todo', label: 'A Fazer' },
  { status: 'in_progress', label: 'Em Andamento' },
  { status: 'blocked', label: 'Bloqueada' },
  { status: 'review', label: 'Em Revisão' },
  { status: 'done', label: 'Concluída' },
  { status: 'cancelled', label: 'Cancelada' },
];

async function getTaskInProject(projectId: number, taskId: number) {
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);

  return task;
}

export interface CreateInternalTaskResult {
  ok: boolean;
  code?: 'project_not_found' | 'invalid_milestone' | 'invalid_assignee';
  message?: string;
  task?: typeof tasks.$inferSelect;
}

// Núcleo transacional de POST /:id/tasks, extraído para reuso pela tool
// projects.create_internal_task (backend/src/agents/tools/projects.ts —
// seção 22/25). A rota abaixo só valida a request e traduz o resultado em
// resposta HTTP; a tool traduz o mesmo resultado em ToolResult.
export async function createInternalTask(
  input: import('zod').infer<typeof createTaskSchema>,
  projectId: number,
  actorUserId: number,
  requestMeta?: { ipAddress?: string; userAgent?: string },
): Promise<CreateInternalTaskResult> {
  const project = await getProjectOrNull(projectId);

  if (!project) {
    return { ok: false, code: 'project_not_found', message: 'Projeto não encontrado.' };
  }

  if (input.milestoneId !== undefined) {
    const milestone = await getMilestoneInProject(project.id, input.milestoneId);

    if (!milestone) {
      return {
        ok: false,
        code: 'invalid_milestone',
        message: 'Milestone inválido para este projeto.',
      };
    }
  }

  if (input.assigneeUserId !== undefined && !(await userExists(input.assigneeUserId))) {
    return {
      ok: false,
      code: 'invalid_assignee',
      message: 'Responsável pela tarefa inválido ou inexistente.',
    };
  }

  const task = await db.transaction(async (tx) => {
    await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.projectId, project.id))
      .for('update');

    const [{ maxPosition }] = await tx
      .select({
        maxPosition: sql<number>`coalesce(max(${tasks.position}), -1)`,
      })
      .from(tasks)
      .where(eq(tasks.projectId, project.id));

    const [insertedTask] = await tx
      .insert(tasks)
      .values({
        ...input,
        projectId: project.id,
        position: input.position ?? Number(maxPosition) + 1,
        createdBy: actorUserId,
      })
      .returning();

    await tx.insert(taskHistory).values({
      taskId: insertedTask.id,
      actorType: 'user',
      actorId: String(actorUserId),
      event: 'task.created',
      newData: insertedTask,
    });

    // Agentes v1.4 (correio.md seção 9) — mesma transação da criação.
    await publishAgentEvent(
      {
        type: 'project.task.created',
        aggregateType: 'project.task',
        aggregateId: insertedTask.id,
        source: 'projects.tasks',
        payload: {
          taskId: insertedTask.id,
          projectId: insertedTask.projectId,
          title: insertedTask.title,
          status: insertedTask.status,
          priority: insertedTask.priority,
        },
      },
      tx,
    );

    await recalcProjectProgress(tx, project.id);

    return insertedTask;
  });

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'task.created',
    entityType: 'task',
    entityId: String(task.id),
    newData: task,
    ipAddress: requestMeta?.ipAddress,
    userAgent: requestMeta?.userAgent,
  });

  return { ok: true, task };
}

export async function taskRoutes(app: FastifyInstance) {
  app.get(
    '/:id/tasks',
    {
      preHandler: [authenticate, requirePermission('tasks.read')],
    },
    async (request, reply) => {
      const params = projectIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listTasksQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const project = await getProjectOrNull(params.data.id);

      if (!project) {
        return notFound(reply, 'Projeto não encontrado.');
      }

      const { page, limit, status, priority, assignee, milestone, due } =
        query.data;

      const dueFilter =
        due === undefined
          ? undefined
          : due === 'overdue'
            ? and(
                sql`${tasks.dueDate} < current_date`,
                sql`${tasks.status} not in ('done', 'cancelled')`,
              )
            : eq(tasks.dueDate, due);

      const filters = [
        eq(tasks.projectId, project.id),
        status ? eq(tasks.status, status) : undefined,
        priority ? eq(tasks.priority, priority) : undefined,
        assignee ? eq(tasks.assigneeUserId, assignee) : undefined,
        milestone ? eq(tasks.milestoneId, milestone) : undefined,
        dueFilter,
      ].filter((filter) => filter !== undefined);

      const where = and(...filters);

      const baseQuery = db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          milestoneId: tasks.milestoneId,
          milestoneName: projectMilestones.name,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          assigneeUserId: tasks.assigneeUserId,
          assigneeName: users.name,
          executionType: tasks.executionType,
          dueDate: tasks.dueDate,
          startedAt: tasks.startedAt,
          completedAt: tasks.completedAt,
          estimatedHours: tasks.estimatedHours,
          actualHours: tasks.actualHours,
          position: tasks.position,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .leftJoin(users, eq(tasks.assigneeUserId, users.id))
        .leftJoin(projectMilestones, eq(tasks.milestoneId, projectMilestones.id));

      const [rows, [{ total }]] = await Promise.all([
        baseQuery
          .where(where)
          .orderBy(desc(tasks.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(tasks).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/:id/tasks',
    {
      preHandler: [authenticate, requirePermission('tasks.create')],
    },
    async (request, reply) => {
      const params = projectIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createTaskSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const result = await createInternalTask(body.data, params.data.id, userId, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (!result.ok) {
        if (result.code === 'project_not_found') {
          return notFound(reply, result.message!);
        }

        return reply.code(422).send({ error: result.code, message: result.message });
      }

      return reply.code(201).send({ data: result.task });
    },
  );

  app.get(
    '/:id/tasks/:taskId',
    {
      preHandler: [authenticate, requirePermission('tasks.read')],
    },
    async (request, reply) => {
      const params = taskParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [task] = await db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          milestoneId: tasks.milestoneId,
          milestoneName: projectMilestones.name,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          assigneeUserId: tasks.assigneeUserId,
          assigneeName: users.name,
          executionType: tasks.executionType,
          executionRef: tasks.executionRef,
          dueDate: tasks.dueDate,
          startedAt: tasks.startedAt,
          completedAt: tasks.completedAt,
          estimatedHours: tasks.estimatedHours,
          actualHours: tasks.actualHours,
          position: tasks.position,
          createdBy: tasks.createdBy,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .leftJoin(users, eq(tasks.assigneeUserId, users.id))
        .leftJoin(projectMilestones, eq(tasks.milestoneId, projectMilestones.id))
        .where(
          and(eq(tasks.id, params.data.taskId), eq(tasks.projectId, params.data.id)),
        )
        .limit(1);

      if (!task) {
        return notFound(reply, 'Tarefa não encontrada neste projeto.');
      }

      return { data: task };
    },
  );

  app.patch(
    '/:id/tasks/:taskId',
    {
      // Sem requirePermission fixo: a autorização é granular por campo
      // alterado (tasks.update, ou tasks.complete/tasks.assign quando o
      // PATCH altera exclusivamente status/assigneeUserId) — ver
      // decisão na seção 1 do plano.
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const params = taskParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateTaskSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const existing = await getTaskInProject(params.data.id, params.data.taskId);

      if (!existing) {
        return notFound(reply, 'Tarefa não encontrada neste projeto.');
      }

      // Autorização granular ANTES de qualquer atalho de leitura — mesmo um
      // PATCH com body vazio não deve devolver os dados da tarefa para quem
      // não tem nenhuma permissão de escrita sobre ela.
      const userId = currentUserId(request);
      const permissionSlugs = await getUserPermissionSlugs(userId);

      const bodyKeys = Object.keys(body.data);
      const isStatusOnly = bodyKeys.length === 1 && bodyKeys[0] === 'status';
      const isAssigneeOnly =
        bodyKeys.length === 1 && bodyKeys[0] === 'assigneeUserId';

      const authorized =
        permissionSlugs.has('tasks.update') ||
        (isStatusOnly && permissionSlugs.has('tasks.complete')) ||
        (isAssigneeOnly && permissionSlugs.has('tasks.assign'));

      if (!authorized) {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Permissão insuficiente.',
        });
      }

      if (bodyKeys.length === 0) {
        return { data: existing };
      }

      if (body.data.milestoneId !== undefined) {
        const milestone = await getMilestoneInProject(
          existing.projectId,
          body.data.milestoneId,
        );

        if (!milestone) {
          return reply.code(422).send({
            error: 'invalid_milestone',
            message: 'Milestone inválido para este projeto.',
          });
        }
      }

      if (
        body.data.assigneeUserId !== undefined &&
        !(await userExists(body.data.assigneeUserId))
      ) {
        return reply.code(422).send({
          error: 'invalid_assignee',
          message: 'Responsável pela tarefa inválido ou inexistente.',
        });
      }

      const statusChanging =
        body.data.status !== undefined && body.data.status !== existing.status;

      const result = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, existing.id))
          .for('update')
          .limit(1);

        const values: Partial<typeof tasks.$inferInsert> = {
          ...body.data,
          updatedAt: new Date(),
        };

        if (statusChanging) {
          if (body.data.status === 'done') {
            values.completedAt = new Date();
          } else if (locked.status === 'done') {
            values.completedAt = null;
          }

          if (body.data.status === 'in_progress' && !locked.startedAt) {
            values.startedAt = new Date();
          }
        }

        const [updated] = await tx
          .update(tasks)
          .set(values)
          .where(eq(tasks.id, locked.id))
          .returning();

        const historyRows: Array<typeof taskHistory.$inferInsert> = [];

        if (statusChanging) {
          historyRows.push({
            taskId: updated.id,
            actorType: 'user',
            actorId: String(userId),
            event: 'task.status_changed',
            oldData: { status: locked.status },
            newData: { status: updated.status },
          });

          if (updated.status === 'done') {
            historyRows.push({
              taskId: updated.id,
              actorType: 'user',
              actorId: String(userId),
              event: 'task.completed',
              newData: { completedAt: updated.completedAt },
            });
          } else if (locked.status === 'done') {
            historyRows.push({
              taskId: updated.id,
              actorType: 'user',
              actorId: String(userId),
              event: 'task.reopened',
              oldData: { status: locked.status },
              newData: { status: updated.status },
            });
          }
        }

        if (
          body.data.assigneeUserId !== undefined &&
          body.data.assigneeUserId !== locked.assigneeUserId
        ) {
          historyRows.push({
            taskId: updated.id,
            actorType: 'user',
            actorId: String(userId),
            event: 'task.assignee_changed',
            oldData: { assigneeUserId: locked.assigneeUserId },
            newData: { assigneeUserId: updated.assigneeUserId },
          });
        }

        if (body.data.priority !== undefined && body.data.priority !== locked.priority) {
          historyRows.push({
            taskId: updated.id,
            actorType: 'user',
            actorId: String(userId),
            event: 'task.priority_changed',
            oldData: { priority: locked.priority },
            newData: { priority: updated.priority },
          });
        }

        if (historyRows.length === 0) {
          historyRows.push({
            taskId: updated.id,
            actorType: 'user',
            actorId: String(userId),
            event: 'task.updated',
            oldData: locked,
            newData: updated,
          });
        }

        await tx.insert(taskHistory).values(historyRows);

        // Agentes v1.4 (correio.md seção 9) — mesma transação da
        // alteração. `project.task.updated` cobre qualquer PATCH;
        // `project.task.completed` é disparado à parte quando o status
        // muda especificamente para 'done' (evento mais específico, seção 3).
        await publishAgentEvent(
          {
            type: 'project.task.updated',
            aggregateType: 'project.task',
            aggregateId: updated.id,
            source: 'projects.tasks',
            payload: { taskId: updated.id, projectId: updated.projectId, status: updated.status, priority: updated.priority },
          },
          tx,
        );

        if (statusChanging && updated.status === 'done') {
          await publishAgentEvent(
            {
              type: 'project.task.completed',
              aggregateType: 'project.task',
              aggregateId: updated.id,
              source: 'projects.tasks',
              payload: { taskId: updated.id, projectId: updated.projectId, priority: updated.priority },
            },
            tx,
          );
        }

        if (statusChanging) {
          await recalcProjectProgress(tx, updated.projectId);
        }

        return { updated, locked };
      });

      const auditAction = statusChanging
        ? body.data.status === 'done'
          ? 'task.completed'
          : 'task.status_changed'
        : body.data.assigneeUserId !== undefined &&
            body.data.assigneeUserId !== result.locked.assigneeUserId
          ? 'task.assignee_changed'
          : 'task.updated';

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: auditAction,
        entityType: 'task',
        entityId: String(result.updated.id),
        oldData: result.locked,
        newData: result.updated,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return { data: result.updated };
    },
  );

  app.get(
    '/:id/board',
    {
      preHandler: [authenticate, requirePermission('tasks.read')],
    },
    async (request, reply) => {
      const params = projectIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const project = await getProjectOrNull(params.data.id);

      if (!project) {
        return notFound(reply, 'Projeto não encontrado.');
      }

      // Uma única query, sem N+1 — agrupamento nas colunas fixas acontece em
      // memória sobre esse resultado já carregado.
      const rows = await db
        .select({
          id: tasks.id,
          milestoneId: tasks.milestoneId,
          milestoneName: projectMilestones.name,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          assigneeUserId: tasks.assigneeUserId,
          assigneeName: users.name,
          dueDate: tasks.dueDate,
          position: tasks.position,
        })
        .from(tasks)
        .leftJoin(users, eq(tasks.assigneeUserId, users.id))
        .leftJoin(projectMilestones, eq(tasks.milestoneId, projectMilestones.id))
        .where(eq(tasks.projectId, project.id))
        .orderBy(tasks.status, tasks.position);

      const columns = BOARD_COLUMNS.map(({ status, label }) => ({
        status,
        label,
        tasks: rows.filter((row) => row.status === status),
      }));

      return { data: { columns } };
    },
  );

  /*
   * Comentários
   */

  app.get(
    '/:id/tasks/:taskId/comments',
    {
      preHandler: [authenticate, requirePermission('tasks.read')],
    },
    async (request, reply) => {
      const params = taskParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listCommentsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const task = await getTaskInProject(params.data.id, params.data.taskId);

      if (!task) {
        return notFound(reply, 'Tarefa não encontrada neste projeto.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select({
            id: taskComments.id,
            taskId: taskComments.taskId,
            userId: taskComments.userId,
            authorName: users.name,
            content: taskComments.content,
            createdAt: taskComments.createdAt,
            updatedAt: taskComments.updatedAt,
          })
          .from(taskComments)
          .leftJoin(users, eq(taskComments.userId, users.id))
          .where(eq(taskComments.taskId, task.id))
          .orderBy(taskComments.createdAt)
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(taskComments)
          .where(eq(taskComments.taskId, task.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/:id/tasks/:taskId/comments',
    {
      preHandler: [authenticate, requirePermission('tasks.comment')],
    },
    async (request, reply) => {
      const params = taskParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createCommentSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const task = await getTaskInProject(params.data.id, params.data.taskId);

      if (!task) {
        return notFound(reply, 'Tarefa não encontrada neste projeto.');
      }

      const userId = currentUserId(request);

      const [comment] = await db
        .insert(taskComments)
        .values({ ...body.data, taskId: task.id, userId })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'task.comment.created',
        entityType: 'task',
        entityId: String(task.id),
        newData: comment,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: comment });
    },
  );

  /*
   * Histórico da tarefa
   */

  app.get(
    '/:id/tasks/:taskId/history',
    {
      preHandler: [authenticate, requirePermission('tasks.read')],
    },
    async (request, reply) => {
      const params = taskParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listHistoryQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const task = await getTaskInProject(params.data.id, params.data.taskId);

      if (!task) {
        return notFound(reply, 'Tarefa não encontrada neste projeto.');
      }

      const { page, limit } = query.data;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(taskHistory)
          .where(eq(taskHistory.taskId, task.id))
          .orderBy(desc(taskHistory.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db
          .select({ total: count() })
          .from(taskHistory)
          .where(eq(taskHistory.taskId, task.id)),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  /*
   * Histórico agregado do projeto (timeline): une audit_logs (projeto,
   * milestones e comentários) com task_history (eventos finos de tarefa),
   * ordenado e paginado no próprio SQL — sem carregar tudo em memória.
   */

  app.get(
    '/:id/history',
    {
      preHandler: [authenticate, requirePermission('projects.read')],
    },
    async (request, reply) => {
      const params = projectIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listHistoryQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const project = await getProjectOrNull(params.data.id);

      if (!project) {
        return notFound(reply, 'Projeto não encontrado.');
      }

      const { page, limit } = query.data;

      const [milestoneRows, taskRows] = await Promise.all([
        db
          .select({ id: projectMilestones.id })
          .from(projectMilestones)
          .where(eq(projectMilestones.projectId, project.id)),
        db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, project.id)),
      ]);

      const milestoneIds = milestoneRows.map((row) => String(row.id));
      const taskIds = taskRows.map((row) => row.id);
      const taskIdStrings = taskIds.map(String);

      const auditFilters = [
        and(
          eq(auditLogs.entityType, 'project'),
          eq(auditLogs.entityId, String(project.id)),
        ),
        milestoneIds.length > 0
          ? and(
              eq(auditLogs.entityType, 'milestone'),
              inArray(auditLogs.entityId, milestoneIds),
            )
          : undefined,
        taskIdStrings.length > 0
          ? and(
              eq(auditLogs.entityType, 'task'),
              eq(auditLogs.action, 'task.comment.created'),
              inArray(auditLogs.entityId, taskIdStrings),
            )
          : undefined,
      ].filter((filter) => filter !== undefined);

      const auditBranch = db
        .select({
          source: sql<string>`'audit'`.as('source'),
          event: auditLogs.action,
          actorType: auditLogs.actorType,
          actorId: auditLogs.actorId,
          oldData: auditLogs.oldData,
          newData: auditLogs.newData,
          metadata: auditLogs.metadata,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(or(...auditFilters));

      const historyBranch = db
        .select({
          source: sql<string>`'task_history'`.as('source'),
          event: taskHistory.event,
          actorType: taskHistory.actorType,
          actorId: taskHistory.actorId,
          oldData: taskHistory.oldData,
          newData: taskHistory.newData,
          metadata: taskHistory.metadata,
          createdAt: taskHistory.createdAt,
        })
        .from(taskHistory)
        .where(
          taskIds.length > 0 ? inArray(taskHistory.taskId, taskIds) : sql`false`,
        );

      const combined = unionAll(auditBranch, historyBranch).as('timeline');

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(combined)
          .orderBy(desc(combined.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(combined),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );
}
