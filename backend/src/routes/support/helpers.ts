import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  clients,
  permissions,
  projects,
  rolePermissions,
  roles,
  supportCategories,
  supportSlaPolicies,
  supportTicketHistory,
  users,
} from '../../db/schema/index.js';

// Duplicado de src/routes/{crm,projects,financial}/helpers.ts de propósito:
// mantém o módulo Suporte independente dos demais (mesmo racional
// documentado nos outros módulos).

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

export function forbidden(reply: FastifyReply) {
  return reply.code(403).send({
    error: 'forbidden',
    message: 'Permissão insuficiente.',
  });
}

export function currentUserId(request: FastifyRequest): number {
  return Number(request.user.sub);
}

export async function getUserPermissionSlugs(userId: number): Promise<Set<string>> {
  const rows = await db
    .select({ slug: permissions.slug })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(users.id, userId));

  return new Set(rows.map((row) => row.slug));
}

export async function getClientOrNull(id: number) {
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  return client;
}

export async function getProjectOrNull(id: number) {
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return project;
}

export async function getCategoryOrNull(id: number) {
  const [category] = await db
    .select()
    .from(supportCategories)
    .where(eq(supportCategories.id, id))
    .limit(1);
  return category;
}

export async function userExists(userId: number): Promise<boolean> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(user);
}

// Seção 9: se projectId for informado, o projeto precisa existir e
// pertencer ao mesmo cliente do ticket.
export async function assertProjectBelongsToClient(
  projectId: number,
  clientId: number,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const project = await getProjectOrNull(projectId);

  if (!project) {
    return { ok: false, code: 'invalid_project', message: 'Projeto inválido ou inexistente.' };
  }

  if (project.clientId !== clientId) {
    return {
      ok: false,
      code: 'client_project_mismatch',
      message: 'O projeto informado não pertence ao cliente do chamado.',
    };
  }

  return { ok: true };
}

// Seção 14: sla_due_at é calculado uma única vez na criação, a partir da
// política ativa para a prioridade do ticket naquele momento. Se não houver
// política ativa, o ticket fica sem SLA (nunca bloqueia a criação).
export async function resolveSlaDueAt(priority: string): Promise<Date | null> {
  const [policy] = await db
    .select()
    .from(supportSlaPolicies)
    .where(eq(supportSlaPolicies.priority, priority))
    .limit(1);

  if (!policy || !policy.isActive) {
    return null;
  }

  return new Date(Date.now() + policy.resolutionMinutes * 60 * 1000);
}

export function todayIso(): string {
  return new Date().toISOString();
}

export interface TicketWithSla {
  status: string;
  slaDueAt: Date | string | null;
  [key: string]: unknown;
}

// isOverdue nunca é persistido — sempre derivado (seção 16).
const TERMINAL_STATUSES = new Set(['resolved', 'closed', 'cancelled']);

export function withOverdue<T extends TicketWithSla>(row: T) {
  const isOverdue =
    !TERMINAL_STATUSES.has(row.status) &&
    row.slaDueAt !== null &&
    new Date(row.slaDueAt).getTime() < Date.now();

  return { ...row, isOverdue };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type { Tx };

export async function recordTicketHistory(
  tx: Tx,
  input: {
    ticketId: number;
    actorType: 'user' | 'agent' | 'system' | 'n8n' | 'worker';
    actorId: string;
    event: string;
    oldData?: unknown;
    newData?: unknown;
    metadata?: unknown;
  },
) {
  await tx.insert(supportTicketHistory).values({
    ticketId: input.ticketId,
    actorType: input.actorType,
    actorId: input.actorId,
    event: input.event,
    oldData: input.oldData,
    newData: input.newData,
    metadata: input.metadata,
  });
}
