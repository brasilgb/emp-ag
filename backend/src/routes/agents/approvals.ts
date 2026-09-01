import type { FastifyInstance } from 'fastify';
import { count, desc, eq, sql } from 'drizzle-orm';

import { approveExecution, rejectExecution } from '../../agents/execution/approvals.js';
import { approvePlanItem, rejectPlanItem } from '../../agents/executor/plan-approvals.js';
import { AgentError } from '../../agents/errors.js';
import { db } from '../../db/index.js';
import { agentActionPlanItems, agentApprovals, agentExecutions, agentTools, agents, users } from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import {
  approvalDecisionSchema,
  approvalIdParamSchema,
  listApprovalsQuerySchema,
} from '../../schemas/agents.js';

import { badRequest, currentUserId, paginationMeta } from './helpers.js';

const requestedByAgents = agents;

// Agentes v1.2 (correio.md seção 5/8): esta tabela e estes endpoints
// atendem tanto uma aprovação de execução única (v1.1, execution_id
// preenchido) quanto uma aprovação de item de Action Plan (plan_item_id
// preenchido) — um único endpoint, sem duplicar rota. `kind` diz ao
// cliente qual dos dois é, para montar o link certo (execução ou plano).
const approvalSelection = {
  id: agentApprovals.id,
  kind: sql<'execution' | 'plan_item'>`case when ${agentApprovals.executionId} is not null then 'execution' else 'plan_item' end`,
  executionId: agentApprovals.executionId,
  planItemId: agentApprovals.planItemId,
  planId: agentActionPlanItems.planId,
  toolHandler: sql<string>`coalesce(${agentTools.handler}, ${agentActionPlanItems.tool})`,
  toolName: sql<string>`coalesce(${agentTools.name}, ${agentActionPlanItems.tool})`,
  agentSlug: sql<string>`coalesce(${requestedByAgents.slug}, ${agentActionPlanItems.agent})`,
  agentName: requestedByAgents.name,
  requestedForUserId: agentApprovals.requestedForUserId,
  requestedForUserName: users.name,
  status: agentApprovals.status,
  reason: agentApprovals.reason,
  requestPayload: agentApprovals.requestPayload,
  decisionPayload: agentApprovals.decisionPayload,
  approvedByUserId: agentApprovals.approvedByUserId,
  decidedAt: agentApprovals.decidedAt,
  expiresAt: agentApprovals.expiresAt,
  createdAt: agentApprovals.createdAt,
};

function baseQuery() {
  return db
    .select(approvalSelection)
    .from(agentApprovals)
    .leftJoin(agentExecutions, eq(agentApprovals.executionId, agentExecutions.id))
    .leftJoin(agentActionPlanItems, eq(agentApprovals.planItemId, agentActionPlanItems.id))
    .leftJoin(
      agentTools,
      sql`${agentTools.id} = coalesce(${agentExecutions.toolId}, ${agentActionPlanItems.toolId})`,
    )
    .leftJoin(requestedByAgents, eq(agentApprovals.requestedByAgentId, requestedByAgents.id))
    .leftJoin(users, eq(agentApprovals.requestedForUserId, users.id));
}

export async function approvalsRoutes(app: FastifyInstance) {
  app.get(
    '/approvals',
    {
      preHandler: [authenticate, requirePermission('agents.approve')],
    },
    async (request, reply) => {
      const query = listApprovalsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, status } = query.data;

      const where = status ? eq(agentApprovals.status, status) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        baseQuery()
          .where(where)
          .orderBy(desc(agentApprovals.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentApprovals).where(where),
      ]);

      return {
        data: rows,
        pagination: paginationMeta({ page, limit, total }),
      };
    },
  );

  app.post(
    '/approvals/:id/approve',
    {
      preHandler: [authenticate, requirePermission('agents.approve')],
    },
    async (request, reply) => {
      const params = approvalIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = approvalDecisionSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const [approvalRow] = await db
        .select({ executionId: agentApprovals.executionId, planItemId: agentApprovals.planItemId })
        .from(agentApprovals)
        .where(eq(agentApprovals.id, params.data.id))
        .limit(1);

      if (!approvalRow) {
        return reply.code(404).send({ error: 'not_found', message: 'Solicitação de aprovação não encontrada.' });
      }

      // Dispatch (correio.md v1.2 seção 5/8): execution_id preenchido →
      // fluxo v1.1 (execution/approvals.ts); plan_item_id preenchido →
      // fluxo de Action Plan (executor/plan-approvals.ts). Nunca os dois
      // ao mesmo tempo — garantido pelos dois únicos pontos de criação de
      // agent_approvals (execution/pipeline.ts e routes/agents/action-plans.ts).
      if (approvalRow.planItemId !== null) {
        const decision = await approvePlanItem(params.data.id, userId, body.data.note);

        if (!decision.ok) {
          return reply.code(decision.code === 'not_found' ? 404 : 409).send({
            error: decision.code,
            message: decision.message,
          });
        }

        return reply.code(200).send({
          status: 'approved',
          approvalId: decision.approvalId,
          planId: decision.planId,
          planItemId: decision.itemId,
        });
      }

      const decision = await approveExecution(params.data.id, userId, body.data.note);

      if (!decision.ok) {
        return reply.code(decision.code === 'not_found' ? 404 : 409).send({
          error: decision.code,
          message: decision.message,
        });
      }

      const outcome = decision.execution;

      if (outcome && (outcome.status === 'failed' || outcome.status === 'rejected')) {
        const agentError = new AgentError(outcome.error!.code, outcome.error!.message);

        return reply.code(agentError.status).send({
          error: agentError.code,
          message: agentError.message,
          executionId: outcome.executionId,
        });
      }

      return reply.code(200).send({
        status: 'approved',
        approvalId: decision.approvalId,
        executionId: outcome?.executionId ?? null,
        result: outcome?.result ?? null,
      });
    },
  );

  app.post(
    '/approvals/:id/reject',
    {
      preHandler: [authenticate, requirePermission('agents.approve')],
    },
    async (request, reply) => {
      const params = approvalIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = approvalDecisionSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const [approvalRow] = await db
        .select({ executionId: agentApprovals.executionId, planItemId: agentApprovals.planItemId })
        .from(agentApprovals)
        .where(eq(agentApprovals.id, params.data.id))
        .limit(1);

      if (!approvalRow) {
        return reply.code(404).send({ error: 'not_found', message: 'Solicitação de aprovação não encontrada.' });
      }

      if (approvalRow.planItemId !== null) {
        const decision = await rejectPlanItem(params.data.id, userId, body.data.note);

        if (!decision.ok) {
          return reply.code(decision.code === 'not_found' ? 404 : 409).send({
            error: decision.code,
            message: decision.message,
          });
        }

        return reply.code(200).send({
          status: 'rejected',
          approvalId: decision.approvalId,
          planId: decision.planId,
          planItemId: decision.itemId,
        });
      }

      const decision = await rejectExecution(params.data.id, userId, body.data.note);

      if (!decision.ok) {
        return reply.code(decision.code === 'not_found' ? 404 : 409).send({
          error: decision.code,
          message: decision.message,
        });
      }

      return reply.code(200).send({
        status: 'rejected',
        approvalId: decision.approvalId,
      });
    },
  );
}
