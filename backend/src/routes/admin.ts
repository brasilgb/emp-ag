import type { FastifyInstance } from 'fastify';

import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/require-permission.js';
import { requireRole } from '../middleware/require-role.js';

export async function adminRoutes(
  app: FastifyInstance,
) {
  app.get(
    '/role-test',
    {
      preHandler: [
        authenticate,
        requireRole('ceo'),
      ],
    },
    async () => {
      return {
        status: 'ok',
        message: 'Role CEO confirmada.',
      };
    },
  );

  app.get(
    '/permission-test',
    {
      preHandler: [
        authenticate,
        requirePermission('users.manage'),
      ],
    },
    async () => {
      return {
        status: 'ok',
        message: 'Permissão users.manage confirmada.',
      };
    },
  );
}