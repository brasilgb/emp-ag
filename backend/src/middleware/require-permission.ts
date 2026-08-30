import type {
  FastifyReply,
  FastifyRequest,
} from 'fastify';

import {
  and,
  eq,
} from 'drizzle-orm';

import { db } from '../db/index.js';

import {
  permissions,
  rolePermissions,
  roles,
  users,
} from '../db/schema/index.js';

export function requirePermission(
  requiredPermission: string,
) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const userId = Number(request.user.sub);

    if (!Number.isInteger(userId)) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Usuário inválido.',
      });
    }

    const [result] = await db
      .select({
        permission: permissions.slug,
      })
      .from(users)
      .innerJoin(
        roles,
        eq(users.roleId, roles.id),
      )
      .innerJoin(
        rolePermissions,
        eq(rolePermissions.roleId, roles.id),
      )
      .innerJoin(
        permissions,
        eq(
          rolePermissions.permissionId,
          permissions.id,
        ),
      )
      .where(
        and(
          eq(users.id, userId),
          eq(
            permissions.slug,
            requiredPermission,
          ),
        ),
      )
      .limit(1);

    if (!result) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Permissão insuficiente.',
      });
    }
  };
}