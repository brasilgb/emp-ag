import type { FastifyInstance } from 'fastify';

import { db } from '../../db/index.js';
import { agentActionPlanItems } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { agentRateLimit } from '../../agents/security/rate-limit.js';
import { audit } from '../../services/audit.js';
import { getDailyOperationsBrief, getOperationalSignalById, listOperationalSignals } from '../../agents/director/operations-service.js';
import { buildObjectiveForSignal } from '../../agents/director/workflows/catalog.js';
import { signalIdParamSchema } from '../../agents/director/schemas.js';
import { executeActionPlan } from '../../agents/executor/action-plan-executor.js';
import { planEvaluateAndPersistActionPlan } from '../../agents/orchestration/create-action-plan.js';

import { badRequest, currentUserId, notFound } from './helpers.js';

/**
 * Agentes v1.8 (correio.md seção 13) — Director Operations API. Nomes
 * consolidados em relação à sugestão literal do correio.md: sem rota
 * `/director/operations` separada de `/director/brief` (redundante — o
 * brief já é a visão consolidada; seção 13 explicitamente permite
 * "avaliar nomes finais seguindo o padrão atual das rotas").
 */
export async function directorRoutes(app: FastifyInstance) {
  app.get(
    '/director/brief',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request) => {
      const brief = await getDailyOperationsBrief();

      const userId = currentUserId(request);
      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'agents.director.brief_generated',
        entityType: 'director_brief',
        entityId: null,
        metadata: { status: brief.status, summary: brief.summary, errors: brief.errors },
      });

      return { data: brief };
    },
  );

  app.get(
    '/director/signals',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async () => {
      const { signals, errors } = await listOperationalSignals();
      return { data: signals, errors };
    },
  );

  app.get(
    '/director/signals/:id',
    { preHandler: [authenticate, requirePermission('agents.read')] },
    async (request, reply) => {
      const params = signalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const signal = await getOperationalSignalById(params.data.id);
      if (!signal) return notFound(reply, 'Sinal não encontrado (pode já ter sido resolvido).');

      return { data: signal };
    },
  );

  // Agentes v1.8 (seção 8/16) — nunca executa a ação: monta o objetivo
  // determinístico a partir do signal/workflow e entra no mesmo pipeline
  // oficial de POST /agents/action-plans (mesmíssima função, mesmas
  // permissions — nenhum bypass de Policy Evaluator/Approvals).
  app.post(
    '/director/signals/:id/propose',
    {
      preHandler: [
        authenticate,
        agentRateLimit('plan'),
        requirePermission('agents.use'),
        requirePermission('agents.plan'),
      ],
    },
    async (request, reply) => {
      const params = signalIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const signal = await getOperationalSignalById(params.data.id);
      if (!signal) return notFound(reply, 'Sinal não encontrado (pode já ter sido resolvido).');

      const objective = buildObjectiveForSignal(signal);
      if (!objective) {
        return reply
          .code(400)
          .send({ error: 'invalid_request', message: `Domínio "${signal.domain}" não tem workflow de proposta de ação.` });
      }

      const userId = currentUserId(request);

      const created = await planEvaluateAndPersistActionPlan({ requestedBy: userId, objective });

      if (!created.ok) {
        if (created.code === 'validation_error') {
          return reply.code(400).send({ error: 'validation_error', message: created.message, details: created.details });
        }

        const agentError = new AgentError(created.code, created.message);
        return reply.code(agentError.status).send({ error: agentError.code, message: agentError.message });
      }

      const finalPlan = await executeActionPlan(created.plan.id, userId);
      const finalItems = await db
        .select()
        .from(agentActionPlanItems)
        .where(eq(agentActionPlanItems.planId, created.plan.id))
        .orderBy(agentActionPlanItems.sequence);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'agents.director.action_proposed',
        entityType: signal.entityType ?? 'operational_signal',
        entityId: signal.entityId ? String(signal.entityId) : signal.id,
        metadata: {
          signalId: signal.id,
          signalType: signal.type,
          domain: signal.domain,
          entityType: signal.entityType,
          entityId: signal.entityId,
          resultingActionPlanId: finalPlan.id,
        },
      });

      return reply.code(201).send({ data: { plan: finalPlan, items: finalItems } });
    },
  );
}
