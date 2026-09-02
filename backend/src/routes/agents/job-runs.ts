import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentAutonomyBlocks,
  agentEventDeliveries,
  agentEvents,
  agentJobRuns,
} from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { jobRunIdParamSchema } from '../../agents/jobs/schemas.js';

import { badRequest, notFound } from './helpers.js';

// GET /agents/job-runs/:id — rota irmã de /agents/jobs/:id/runs (correio.md
// v1.3 seção 15), fora do prefixo de Job porque um Run é identificado
// pelo próprio id, sem precisar do jobId na URL.
export async function jobRunsRoutes(app: FastifyInstance) {
  app.get(
    '/job-runs/:id',
    { preHandler: [authenticate, requirePermission('agents.runs.read')] },
    async (request, reply) => {
      const params = jobRunIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [run] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, params.data.id)).limit(1);

      if (!run) {
        return notFound(reply, 'Run não encontrado.');
      }

      return { data: run };
    },
  );

  // Agentes v1.5 (correio.md seção 18/20) — reconstrução da cadeia causal
  // inteira a partir de um Run qualquer da cadeia. Consulta única
  // indexada por root_execution_id (agent_job_runs_root_execution_id_idx),
  // nunca CTE recursiva (seção 28) — a árvore já é naturalmente limitada
  // por AGENT_MAX_AUTONOMY_DEPTH/AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN. O
  // frontend monta a árvore a partir de `causationRunId` em cada linha.
  app.get(
    '/job-runs/:id/lineage',
    { preHandler: [authenticate, requirePermission('agents.runs.read')] },
    async (request, reply) => {
      const params = jobRunIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [run] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, params.data.id)).limit(1);

      if (!run) {
        return notFound(reply, 'Run não encontrado.');
      }

      const rootExecutionId = run.rootExecutionId ?? run.id;

      const [runs, blocks] = await Promise.all([
        db
          .select()
          .from(agentJobRuns)
          .where(eq(agentJobRuns.rootExecutionId, rootExecutionId))
          .orderBy(asc(agentJobRuns.createdAt)),
        db
          .select()
          .from(agentAutonomyBlocks)
          .where(eq(agentAutonomyBlocks.rootExecutionId, rootExecutionId))
          .orderBy(asc(agentAutonomyBlocks.createdAt)),
      ]);

      return { data: { rootExecutionId, runs, blocks } };
    },
  );

  // Agentes v1.6 (correio.md seção 4) — Execution Timeline. Endpoint
  // composto único (seção 11: "não pode executar dezenas de requests por
  // render") que reconstrói Job → Run → Action Plan → Plan Items →
  // Events publicados → Runs causados diretamente → causador (rule/event
  // que disparou este Run, via causation_event_delivery_id). Tudo por
  // consultas indexadas (job_run_id, caused_by_run_id, causation_run_id),
  // nunca N+1 nem CTE recursiva.
  app.get(
    '/job-runs/:id/detail',
    { preHandler: [authenticate, requirePermission('agents.runs.read')] },
    async (request, reply) => {
      const params = jobRunIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [run] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, params.data.id)).limit(1);

      if (!run) {
        return notFound(reply, 'Run não encontrado.');
      }

      const [actionPlan, causingDelivery, causedEvents, childRuns] = await Promise.all([
        run.actionPlanId
          ? db.select().from(agentActionPlans).where(eq(agentActionPlans.id, run.actionPlanId)).limit(1)
          : Promise.resolve([]),
        run.causationEventDeliveryId
          ? db
              .select()
              .from(agentEventDeliveries)
              .where(eq(agentEventDeliveries.id, run.causationEventDeliveryId))
              .limit(1)
          : Promise.resolve([]),
        db.select().from(agentEvents).where(eq(agentEvents.causedByRunId, run.id)).orderBy(asc(agentEvents.receivedAt)),
        db.select().from(agentJobRuns).where(eq(agentJobRuns.causationRunId, run.id)).orderBy(asc(agentJobRuns.createdAt)),
      ]);

      const planItems = run.actionPlanId
        ? await db
            .select()
            .from(agentActionPlanItems)
            .where(eq(agentActionPlanItems.planId, run.actionPlanId))
            .orderBy(asc(agentActionPlanItems.sequence))
        : [];

      return {
        data: {
          run,
          actionPlan: actionPlan[0] ?? null,
          planItems,
          causedByDelivery: causingDelivery[0] ?? null,
          eventsPublished: causedEvents,
          childRuns,
        },
      };
    },
  );
}
