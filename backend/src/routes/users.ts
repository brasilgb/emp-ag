import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { roles, users } from '../db/schema/index.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/require-permission.js';

// Diretório mínimo de usuários — usado apenas para popular seletores de
// responsável/atribuído em Projetos e Tarefas (não é gestão de usuários,
// por isso a permissão dedicada `users.directory.read`, mais granular que
// `users.read`). Nunca retorna passwordHash ou qualquer dado sensível.
export async function usersRoutes(app: FastifyInstance) {
  app.get(
    '/users',
    {
      preHandler: [authenticate, requirePermission('users.directory.read')],
    },
    async () => {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: roles.name,
        })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(eq(users.isActive, true))
        .orderBy(asc(users.name));

      return { data: rows };
    },
  );
}
