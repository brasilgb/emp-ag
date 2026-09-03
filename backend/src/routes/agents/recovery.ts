import type { FastifyInstance } from 'fastify';

import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { env } from '../../config/env.js';
import { scanStaleWorkflows } from '../../agents/recovery/detector.js';
import { getRecoveryStatus, reconcileOne, runRecovery } from '../../agents/recovery/recovery-service.js';
import { recoveryEntityParamSchema, recoveryEntityQuerySchema, recoveryStaleQuerySchema, runRecoveryQuerySchema } from '../../agents/recovery/schemas.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

/**
 * Agentes v2.4 (correio.md seções 16/17) — API operacional mínima do
 * recovery/reconciliação. `agents.recovery.manage` protege as rotas que
 * MUDAM estado (`POST /run`, `POST /:type/:id`) — reaproveita
 * `agents.operations.read` para as duas leituras (`GET /status`,
 * `GET /stale`), mesma natureza de observabilidade operacional do
 * dashboard v1.8 (seção 17: "leitura de status pode usar permission
 * mais ampla de observabilidade/admin").
 */
export async function recoveryRoutes(app: FastifyInstance) {
  app.get(
    '/recovery/status',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = recoveryStaleQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      return { data: await getRecoveryStatus(query.data.thresholdSeconds) };
    },
  );

  app.get(
    '/recovery/stale',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = recoveryStaleQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const thresholdSeconds = query.data.thresholdSeconds ?? env.AGENT_WORKFLOW_STALE_AFTER_SECONDS;
      const { candidates, errors } = await scanStaleWorkflows(thresholdSeconds);
      return { data: candidates, errors };
    },
  );

  // Agentes v2.4 (correio.md seção 18) — manual/administrativo nesta
  // versão ("não criar daemon automaticamente de início"). `dryRun=true`
  // nunca escreve no banco (repassado até `adapter.reconcile`).
  app.post(
    '/recovery/run',
    { preHandler: [authenticate, requirePermission('agents.recovery.manage')] },
    async (request, reply) => {
      const query = runRecoveryQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const report = await runRecovery({ dryRun: query.data.dryRun, actorUserId: currentUserId(request) });
      return { data: report };
    },
  );

  // Agentes v2.4 (correio.md seção 16) — reconciliação manual de UM item
  // específico, só quando houver necessidade clara (ex.: operador já
  // identificou a entidade via GET /stale).
  app.post(
    '/recovery/:type/:id',
    { preHandler: [authenticate, requirePermission('agents.recovery.manage')] },
    async (request, reply) => {
      const params = recoveryEntityParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const query = recoveryEntityQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const result = await reconcileOne({
        workflowType: params.data.type,
        entityId: params.data.id,
        dryRun: query.data.dryRun,
        actorUserId: currentUserId(request),
      });

      if (!result) return notFound(reply, 'Entidade não está stale (ou não existe) — nada para reconciliar.');

      return { data: result };
    },
  );
}
