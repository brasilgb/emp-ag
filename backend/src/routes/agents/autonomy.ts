import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { isAutonomousExecutionEnabled, setAutonomousExecutionEnabled } from '../../agents/jobs/global-switch.js';
import { audit } from '../../services/audit.js';

import { badRequest, currentUserId } from './helpers.js';

const setGlobalAutonomySchema = z.object({ enabled: z.boolean() }).strict();

/**
 * Agentes v1.6 (correio.md seção 7) — o global autonomy switch já existe
 * desde a v1.3 (agents/jobs/global-switch.ts, tabela `settings`), mas
 * nunca teve endpoint HTTP dedicado (só era alterado internamente/por
 * teste). "Caso não exista interface adequada, implementar endpoint
 * autorizado e auditado" — reaproveita a função existente, nunca duplica
 * a lógica do switch.
 */
export async function autonomyRoutes(app: FastifyInstance) {
  app.get(
    '/autonomy',
    { preHandler: [authenticate, requirePermission('agents.autonomy.manage')] },
    async () => {
      const enabled = await isAutonomousExecutionEnabled();
      return { data: { enabled } };
    },
  );

  app.patch(
    '/autonomy',
    { preHandler: [authenticate, requirePermission('agents.autonomy.manage')] },
    async (request, reply) => {
      const body = setGlobalAutonomySchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const previous = await isAutonomousExecutionEnabled();
      await setAutonomousExecutionEnabled(body.data.enabled);

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: body.data.enabled ? 'agent_autonomy.global_enabled' : 'agent_autonomy.global_disabled',
        entityType: 'agent_global_autonomy',
        entityId: 'global',
        metadata: { previous, next: body.data.enabled },
      });

      return { data: { enabled: body.data.enabled } };
    },
  );
}
