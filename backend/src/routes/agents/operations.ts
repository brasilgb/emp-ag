import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentApprovals,
  agentAutonomyBlocks,
  agentEventDeliveries,
  agentEvents,
  agentJobRuns,
  agentJobs,
} from '../../db/schema/index.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { AUTONOMY_BLOCK_REASONS } from '../../agents/autonomy/reasons.js';

import { badRequest, currentUserId } from './helpers.js';
import { operationsSummaryQuerySchema, superviseQuerySchema } from '../../agents/operations/schemas.js';
import { getOperationalHealth } from '../../agents/operations/health-service.js';
import { runOperationalSupervision } from '../../agents/operations/supervisor-service.js';

/**
 * Agentes v1.6 (correio.md seção 3) — Operations Dashboard.
 *
 * Uma única rota agregada, tudo calculado via SQL (`count(*) filter`),
 * mesmo padrão de routes/support/stats.ts (e financial/customer-success) —
 * nunca carrega Jobs/Runs/Events no Node para contar (seção 11:
 * "não calcular essas métricas no frontend a partir de centenas de
 * registros"). Contagem de Jobs/Approvals é sempre total (não tem
 * `createdAt` correspondente a um "período" natural no domínio de Job —
 * um Job existe indefinidamente); Runs/Autonomous/Events são escopados
 * pelo período (`from`/`to`, default últimos 7 dias) porque volume de
 * execução cresce sem limite ao longo do tempo.
 */
// Exportada para reuso pelo Director Operations Service (correio.md v1.8
// seção 6 — "existem circuit breakers abertos?"/"Jobs com problema" no
// domínio "agents" do briefing), mesmo racional de reuso das outras
// funções já exportadas para director.get_business_overview (v1.6).
export async function getJobsSummary() {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${agentJobs.status} = 'active')`,
      paused: sql<number>`count(*) filter (where ${agentJobs.status} = 'paused')`,
      draft: sql<number>`count(*) filter (where ${agentJobs.status} = 'draft')`,
      completed: sql<number>`count(*) filter (where ${agentJobs.status} = 'completed')`,
      failed: sql<number>`count(*) filter (where ${agentJobs.status} = 'failed')`,
      cancelled: sql<number>`count(*) filter (where ${agentJobs.status} = 'cancelled')`,
      autonomyDisabled: sql<number>`count(*) filter (where ${agentJobs.autonomyEnabled} = false)`,
      circuitOpen: sql<number>`count(*) filter (where ${agentJobs.circuitState} = 'open')`,
      circuitHalfOpen: sql<number>`count(*) filter (where ${agentJobs.circuitState} = 'half_open')`,
    })
    .from(agentJobs);

  return {
    total: Number(row.total),
    active: Number(row.active),
    paused: Number(row.paused),
    draft: Number(row.draft),
    completed: Number(row.completed),
    failed: Number(row.failed),
    cancelled: Number(row.cancelled),
    autonomyDisabled: Number(row.autonomyDisabled),
    circuitOpen: Number(row.circuitOpen),
    circuitHalfOpen: Number(row.circuitHalfOpen),
  };
}

async function getRunsSummary(from: Date, to: Date) {
  const [row] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'queued')`,
      planning: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'planning')`,
      running: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'running')`,
      waitingApproval: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'waiting_approval')`,
      completed: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'completed')`,
      partial: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'partial')`,
      failed: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'failed')`,
      blocked: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'blocked')`,
      cancelled: sql<number>`count(*) filter (where ${agentJobRuns.status} = 'cancelled')`,
    })
    .from(agentJobRuns)
    .where(sql`${agentJobRuns.createdAt} >= ${from} and ${agentJobRuns.createdAt} <= ${to}`);

  return {
    queued: Number(row.queued),
    planning: Number(row.planning),
    running: Number(row.running),
    waitingApproval: Number(row.waitingApproval),
    completed: Number(row.completed),
    partial: Number(row.partial),
    failed: Number(row.failed),
    blocked: Number(row.blocked),
    cancelled: Number(row.cancelled),
  };
}

async function getAutonomousSummary(from: Date, to: Date) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      cycleDetected: sql<number>`count(*) filter (where ${agentAutonomyBlocks.reason} = 'autonomous_cycle_detected')`,
      rateLimited: sql<number>`count(*) filter (where ${agentAutonomyBlocks.reason} = 'autonomous_rate_limit_exceeded')`,
      depthExceeded: sql<number>`count(*) filter (where ${agentAutonomyBlocks.reason} = 'autonomy_depth_exceeded')`,
      chainBudgetExceeded: sql<number>`count(*) filter (where ${agentAutonomyBlocks.reason} = 'autonomy_chain_budget_exceeded')`,
      circuitOpenBlocks: sql<number>`count(*) filter (where ${agentAutonomyBlocks.reason} = 'autonomy_circuit_open')`,
      jobDisabledBlocks: sql<number>`count(*) filter (where ${agentAutonomyBlocks.reason} = 'autonomy_job_disabled')`,
    })
    .from(agentAutonomyBlocks)
    .where(sql`${agentAutonomyBlocks.createdAt} >= ${from} and ${agentAutonomyBlocks.createdAt} <= ${to}`);

  return {
    blockedTotal: Number(row.total),
    cycleDetected: Number(row.cycleDetected),
    rateLimited: Number(row.rateLimited),
    depthExceeded: Number(row.depthExceeded),
    chainBudgetExceeded: Number(row.chainBudgetExceeded),
    circuitOpenBlocks: Number(row.circuitOpenBlocks),
    jobDisabledBlocks: Number(row.jobDisabledBlocks),
    // reasons fechados (agents/autonomy/reasons.ts) ecoados aqui só para
    // o frontend nunca precisar duplicar a lista — nunca uma string solta.
    reasons: AUTONOMY_BLOCK_REASONS,
  };
}

async function getEventsSummary(from: Date, to: Date) {
  const [eventsRow] = await db
    .select({
      created: sql<number>`count(*)`,
      processed: sql<number>`count(*) filter (where ${agentEvents.status} = 'processed')`,
      pending: sql<number>`count(*) filter (where ${agentEvents.status} = 'pending')`,
      ignored: sql<number>`count(*) filter (where ${agentEvents.status} = 'ignored')`,
      failed: sql<number>`count(*) filter (where ${agentEvents.status} = 'failed')`,
    })
    .from(agentEvents)
    .where(sql`${agentEvents.receivedAt} >= ${from} and ${agentEvents.receivedAt} <= ${to}`);

  const [deliveriesRow] = await db
    .select({
      failed: sql<number>`count(*) filter (where ${agentEventDeliveries.status} = 'failed')`,
    })
    .from(agentEventDeliveries)
    .where(sql`${agentEventDeliveries.createdAt} >= ${from} and ${agentEventDeliveries.createdAt} <= ${to}`);

  return {
    created: Number(eventsRow.created),
    processed: Number(eventsRow.processed),
    pending: Number(eventsRow.pending),
    ignored: Number(eventsRow.ignored),
    failed: Number(eventsRow.failed),
    deliveriesFailed: Number(deliveriesRow.failed),
  };
}

// Agentes v1.8 — mesmo racional de getJobsSummary acima.
export async function getApprovalsSummary() {
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${agentApprovals.status} = 'pending')`,
      approved: sql<number>`count(*) filter (where ${agentApprovals.status} = 'approved')`,
      rejected: sql<number>`count(*) filter (where ${agentApprovals.status} = 'rejected')`,
      expired: sql<number>`count(*) filter (where ${agentApprovals.status} = 'expired')`,
      cancelled: sql<number>`count(*) filter (where ${agentApprovals.status} = 'cancelled')`,
    })
    .from(agentApprovals);

  return {
    pending: Number(row.pending),
    approved: Number(row.approved),
    rejected: Number(row.rejected),
    expired: Number(row.expired),
    cancelled: Number(row.cancelled),
  };
}

export async function operationsRoutes(app: FastifyInstance) {
  app.get(
    '/operations/summary',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = operationsSummaryQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const to = query.data.to ?? new Date();
      // Default 7 dias (seção 3): período operacional útil sem exigir
      // que o cliente sempre informe from/to.
      const from = query.data.from ?? new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [jobs, runs, autonomous, events, approvals] = await Promise.all([
        getJobsSummary(),
        getRunsSummary(from, to),
        getAutonomousSummary(from, to),
        getEventsSummary(from, to),
        getApprovalsSummary(),
      ]);

      return {
        data: {
          period: { from: from.toISOString(), to: to.toISOString() },
          jobs,
          runs,
          autonomous,
          events,
          approvals,
        },
      };
    },
  );

  // Agentes v2.5 (correio.md seção 23) — Operational Supervisor.
  // Leitura em `agents.operations.read` (mesma permission já usada por
  // `/operations/summary`, mesma natureza de observabilidade
  // operacional); execução real em `agents.operations.manage`
  // (justificada — mais ampla que `agents.recovery.manage`, que só
  // cobre reconciliação de workflow, ver seção 22 e `executed.md`).
  app.get(
    '/operations/health',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async () => ({ data: await getOperationalHealth() }),
  );

  app.get(
    '/operations/incidents',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async () => {
      const health = await getOperationalHealth();
      return { data: health.incidents };
    },
  );

  app.post(
    '/operations/supervise',
    { preHandler: [authenticate, requirePermission('agents.operations.manage')] },
    async (request, reply) => {
      const query = superviseQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const report = await runOperationalSupervision({ dryRun: query.data.dryRun, actorUserId: currentUserId(request) });
      return { data: report };
    },
  );
}
