import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { projectMilestones } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { audit } from '../../services/audit.js';
import {
  createMilestoneSchema,
  milestoneParamSchema,
  projectIdParamSchema,
  updateMilestoneSchema,
} from '../../schemas/projects.js';

import {
  badRequest,
  currentUserId,
  getMilestoneInProject,
  getProjectOrNull,
  notFound,
} from './helpers.js';

export async function milestoneRoutes(app: FastifyInstance) {
  app.get(
    '/:id/milestones',
    {
      preHandler: [authenticate, requirePermission('milestones.read')],
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

      const rows = await db
        .select()
        .from(projectMilestones)
        .where(eq(projectMilestones.projectId, project.id))
        .orderBy(projectMilestones.position);

      return { data: rows };
    },
  );

  app.post(
    '/:id/milestones',
    {
      preHandler: [authenticate, requirePermission('milestones.create')],
    },
    async (request, reply) => {
      const params = projectIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = createMilestoneSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const project = await getProjectOrNull(params.data.id);

      if (!project) {
        return notFound(reply, 'Projeto não encontrado.');
      }

      const [milestone] = await db
        .insert(projectMilestones)
        .values({ ...body.data, projectId: project.id })
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'milestone.created',
        entityType: 'milestone',
        entityId: String(milestone.id),
        newData: milestone,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(201).send({ data: milestone });
    },
  );

  app.patch(
    '/:id/milestones/:milestoneId',
    {
      preHandler: [authenticate, requirePermission('milestones.update')],
    },
    async (request, reply) => {
      const params = milestoneParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateMilestoneSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const existing = await getMilestoneInProject(
        params.data.id,
        params.data.milestoneId,
      );

      if (!existing) {
        return notFound(reply, 'Milestone não encontrado neste projeto.');
      }

      if (Object.keys(body.data).length === 0) {
        return { data: existing };
      }

      const values: Partial<typeof projectMilestones.$inferInsert> = {
        ...body.data,
        updatedAt: new Date(),
      };

      // Ao entrar em "completed", preenche completedAt; ao sair, limpa.
      if (body.data.status === 'completed' && existing.status !== 'completed') {
        values.completedAt = new Date();
      } else if (
        body.data.status !== undefined &&
        body.data.status !== 'completed' &&
        existing.status === 'completed'
      ) {
        values.completedAt = null;
      }

      const [updated] = await db
        .update(projectMilestones)
        .set(values)
        .where(eq(projectMilestones.id, existing.id))
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action:
          updated.status === 'completed' && existing.status !== 'completed'
            ? 'milestone.completed'
            : 'milestone.updated',
        entityType: 'milestone',
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
