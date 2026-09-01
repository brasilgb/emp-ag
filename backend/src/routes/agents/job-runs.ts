import type { FastifyInstance } from 'fastify';
import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentAutonomyBlocks, agentJobRuns } from '../../db/schema/index.js';
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
}
