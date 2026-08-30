import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  permissions,
  projectMilestones,
  projects,
  rolePermissions,
  roles,
  tasks,
  users,
} from '../../db/schema/index.js';

// Duplicado de src/routes/crm/helpers.ts de propósito: mantém o módulo de
// Projetos independente do CRM, sem risco para as rotas/testes já
// existentes.

export function paginationMeta({
  page,
  limit,
  total,
}: {
  page: number;
  limit: number;
  total: number;
}) {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

export function badRequest(reply: FastifyReply, error: ZodError) {
  return reply.code(400).send({
    error: 'invalid_request',
    message: error.issues[0]?.message ?? 'Dados inválidos.',
  });
}

export function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({
    error: 'not_found',
    message,
  });
}

export function currentUserId(request: FastifyRequest): number {
  return Number(request.user.sub);
}

export async function getProjectOrNull(id: number) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  return project;
}

// Garante que o milestone referenciado por uma tarefa pertence de fato ao
// projeto informado — rejeita cross-project reference.
export async function getMilestoneInProject(
  projectId: number,
  milestoneId: number,
) {
  const [milestone] = await db
    .select()
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.id, milestoneId),
        eq(projectMilestones.projectId, projectId),
      ),
    )
    .limit(1);

  return milestone;
}

export async function userExists(userId: number): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return Boolean(user);
}

export async function getUserPermissionSlugs(
  userId: number,
): Promise<Set<string>> {
  const rows = await db
    .select({ slug: permissions.slug })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(users.id, userId));

  return new Set(rows.map((row) => row.slug));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Recalcula projects.progress a partir das tarefas do projeto: tarefas
// concluídas / tarefas totais * 100, excluindo `cancelled` do denominador.
// Deve ser chamado dentro da mesma transação que alterou as tarefas, com a
// linha do projeto travada (FOR UPDATE) para evitar condição de corrida em
// atualizações concorrentes (ex.: duas mudanças de status simultâneas).
export async function recalcProjectProgress(tx: Tx, projectId: number) {
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update');

  const [row] = await tx
    .select({
      total: sql<number>`count(*) filter (where ${tasks.status} <> 'cancelled')`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'done')`,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));

  const total = Number(row?.total ?? 0);
  const done = Number(row?.done ?? 0);
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  await tx
    .update(projects)
    .set({ progress, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  return progress;
}
