import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';
import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  clients,
  customerSuccessAccounts,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../db/schema/index.js';

// Duplicado de src/routes/{crm,projects,financial,support}/helpers.ts de
// propósito: mantém o módulo Customer Success independente dos demais.

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

export async function userExists(userId: number): Promise<boolean> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(user);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type { Tx };

// Seção 31: mecanismo idempotente para inicializar uma conta CS "sob
// demanda" — nunca acoplado à criação de clientes no CRM. `onConflictDoNothing`
// aproveita a unique constraint em clientId para ser seguro mesmo sob
// concorrência, sem precisar de FOR UPDATE aqui (não há linha para travar
// antes dela existir).
export async function ensureCsAccount(
  tx: Tx,
  clientId: number,
): Promise<{ account: typeof customerSuccessAccounts.$inferSelect; created: boolean }> {
  const [existing] = await tx
    .select()
    .from(customerSuccessAccounts)
    .where(eq(customerSuccessAccounts.clientId, clientId))
    .limit(1);

  if (existing) {
    return { account: existing, created: false };
  }

  await tx
    .insert(customerSuccessAccounts)
    .values({ clientId })
    .onConflictDoNothing({ target: customerSuccessAccounts.clientId });

  const [account] = await tx
    .select()
    .from(customerSuccessAccounts)
    .where(eq(customerSuccessAccounts.clientId, clientId))
    .limit(1);

  return { account, created: true };
}
