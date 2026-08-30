import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authenticate.js';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { permissions, roles, rolePermissions, users } from '../db/schema/index.js';
import { audit } from '../services/audit.js';

interface LoginBody {
  email?: string;
  password?: string;
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const email = request.body?.email?.trim().toLowerCase();
    const password = request.body?.password;

    if (!email || !password) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'E-mail e senha são obrigatórios.',
      });
    }

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
        roleId: roles.id,
        roleName: roles.name,
        roleSlug: roles.slug,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      await audit({
        actorType: 'user',
        actorId: email,
        action: 'auth.login.failed',
        metadata: {
          reason: 'invalid_credentials',
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(401).send({
        error: 'invalid_credentials',
        message: 'E-mail ou senha inválidos.',
      });
    }

    if (!user.isActive) {
      await audit({
        userId: user.id,
        actorType: 'user',
        actorId: String(user.id),
        action: 'auth.login.failed',
        metadata: {
          reason: 'inactive_user',
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(403).send({
        error: 'user_inactive',
        message: 'Usuário inativo.',
      });
    }

    const passwordValid = await bcrypt.compare(
      password,
      user.passwordHash,
    );

    if (!passwordValid) {
      await audit({
        userId: user.id,
        actorType: 'user',
        actorId: String(user.id),
        action: 'auth.login.failed',
        metadata: {
          reason: 'invalid_credentials',
        },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      return reply.code(401).send({
        error: 'invalid_credentials',
        message: 'E-mail ou senha inválidos.',
      });
    }

    const token = await reply.jwtSign({
      sub: String(user.id),
      email: user.email,
      role: user.roleSlug,
    });

    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await audit({
      userId: user.id,
      actorType: 'user',
      actorId: String(user.id),
      action: 'auth.login.success',
      metadata: {
        role: user.roleSlug,
      },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: {
          id: user.roleId,
          name: user.roleName,
          slug: user.roleSlug,
        },
      },
    };
  });

  app.get(
    '/me',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const userId = Number(request.user.sub);

      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          isActive: users.isActive,

          roleId: roles.id,
          roleName: roles.name,
          roleSlug: roles.slug,
        })
        .from(users)
        .innerJoin(
          roles,
          eq(users.roleId, roles.id),
        )
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || !user.isActive) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Usuário não autorizado.',
        });
      }

      // Uma única query extra (independe de quantas permissões existam) —
      // evita N+1 ao montar a lista de permissões do usuário.
      const permissionRows = await db
        .select({
          slug: permissions.slug,
        })
        .from(rolePermissions)
        .innerJoin(
          permissions,
          eq(rolePermissions.permissionId, permissions.id),
        )
        .where(eq(rolePermissions.roleId, user.roleId));

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,

          role: {
            id: user.roleId,
            name: user.roleName,
            slug: user.roleSlug,
          },

          permissions: permissionRows.map((row) => row.slug),
        },
      };
    },
  );
}
