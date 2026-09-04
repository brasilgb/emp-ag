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

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';
import {
  listSupervisionIncidentsQuerySchema,
  listSupervisionRunsQuerySchema,
  operationsSummaryQuerySchema,
  patchSupervisionSchedulerSchema,
  supervisionIncidentIdParamSchema,
  supervisionInsightsOverviewQuerySchema,
  supervisionRunIdParamSchema,
  superviseQuerySchema,
} from '../../agents/operations/schemas.js';
import { getOperationalHealth } from '../../agents/operations/health-service.js';
import { getOperationalSupervisionSchedulerStatus } from '../../agents/operations/scheduler-status.js';
import { isOperationalSupervisionEnabled, setOperationalSupervisionEnabled } from '../../agents/operations/scheduler-settings.js';
import { SupervisionAlreadyRunningError } from '../../agents/operations/supervisor-guard.js';
import { getSupervisionRunById, listSupervisionRuns, runObservedOperationalSupervision } from '../../agents/operations/supervision-run-history.js';
import { getSupervisionIncidentDetail, getSupervisionOverview, listRecurringIncidents, listSupervisionIncidents } from '../../agents/operations/supervision-insights-service.js';
import { getControlCenterOverview, getOperationalQueues } from '../../agents/operations/control-center-service.js';
import { audit } from '../../services/audit.js';

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

// v3.0 (correio.md "Etapa 1/2" — Control Center) — exportada pelo mesmo
// motivo que `getJobsSummary`/`getApprovalsSummary` acima: reuso direto
// de `agents/operations/control-center-service.ts` (jobRunsFailedRecent),
// nunca uma segunda query reimplementando a mesma contagem.
export async function getRunsSummary(from: Date, to: Date) {
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

      try {
        // Agentes v2.5.1 (correio.md seções 27/28/29) — passa pelo MESMO
        // guard central do scheduler automático (nunca dois guards
        // independentes) — uma supervisão manual enquanto outra (manual
        // ou automática) já está rodando devolve 409, nunca enfileira.
        // v3.4 — `runObservedOperationalSupervision` envolve essa MESMA
        // cadeia por fora, só para registrar o histórico persistente; o
        // 409 abaixo (`SupervisionAlreadyRunningError`) continua vindo
        // exatamente do mesmo lugar de antes, contrato desta rota
        // inalterado.
        const report = await runObservedOperationalSupervision({ dryRun: query.data.dryRun, actorUserId: currentUserId(request), triggeredBy: 'manual' });
        return { data: report };
      } catch (error) {
        if (error instanceof SupervisionAlreadyRunningError) {
          return reply.code(409).send({ error: 'conflict', message: error.message });
        }
        throw error;
      }
    },
  );

  // Agentes v2.5.1 (correio.md seções 17/22) — observabilidade e
  // administração do scheduler automático. Leitura em
  // `agents.operations.read` (mesma da v2.5); alteração em
  // `agents.operations.manage` (mesma da v2.5 — seção 23: "reaproveitar
  // permission da v2.5, não criar nova sem necessidade objetiva").
  app.get(
    '/operations/scheduler',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async () => ({ data: await getOperationalSupervisionSchedulerStatus() }),
  );

  app.patch(
    '/operations/scheduler',
    { preHandler: [authenticate, requirePermission('agents.operations.manage')] },
    async (request, reply) => {
      const body = patchSupervisionSchedulerSchema.safeParse(request.body ?? {});
      if (!body.success) return badRequest(reply, body.error);

      const previous = await isOperationalSupervisionEnabled();
      await setOperationalSupervisionEnabled(body.data.enabled);

      const userId = currentUserId(request);
      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: body.data.enabled ? 'agents.operations.scheduler.enabled' : 'agents.operations.scheduler.disabled',
        entityType: 'agent_operational_supervision',
        entityId: null,
        metadata: { previous, next: body.data.enabled },
      });

      return { data: await getOperationalSupervisionSchedulerStatus() };
    },
  );

  // Agentes v3.0 (correio.md "Etapa 2") — Operational Control Center.
  // Mesma permission de leitura já usada por TODA esta rota
  // (`agents.operations.read`) — mesmo precedente já aceito de
  // `/operations/summary` (v1.6) devolver contagens agregadas de
  // Approvals sem exigir `agents.approve` separadamente: overview e
  // filas aqui são só CONTAGENS e resumos (título/status/prioridade/
  // datas/ids para link) — nunca o conteúdo completo de um Action Plan
  // (isso continua exigindo `agents.plan.read`, ver
  // `GET /follow-ups/:id/timeline` em `follow-ups.ts`).
  app.get(
    '/operations/control-center',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async () => {
      const [overview, queues] = await Promise.all([getControlCenterOverview(), getOperationalQueues()]);
      return { data: { overview, queues } };
    },
  );

  // Agentes v3.4 (correio.md "11. API") — histórico de execuções do
  // Operational Supervisor. Mesma permission de leitura de TODA esta
  // rota (`agents.operations.read`) — correio.md pediu explicitamente
  // para reutilizar essa permission "salvo impossibilidade arquitetural
  // concreta", e não há nenhuma aqui.
  app.get(
    '/operations/supervision-runs',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = listSupervisionRunsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { rows, total } = await listSupervisionRuns(query.data);
      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/operations/supervision-runs/:id',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const params = supervisionRunIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const run = await getSupervisionRunById(params.data.id);
      if (!run) return notFound(reply, 'Execução de supervisão não encontrada.');

      return { data: run };
    },
  );

  // Agentes v3.5 (correio.md "Operational Supervision Insights & Incident
  // Review") — leitura pura sobre dados já persistidos (v2.5/v2.6/v3.4),
  // mesma permission `agents.operations.read` de toda esta rota (correio.md
  // não pediu uma permission nova, e reaproveitar é o padrão já
  // estabelecido para /supervision-runs acima).
  app.get(
    '/operations/supervision-insights/overview',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = supervisionInsightsOverviewQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      return { data: await getSupervisionOverview(query.data) };
    },
  );

  app.get(
    '/operations/supervision-insights/incidents',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = listSupervisionIncidentsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      // `hasEscalation` deliberadamente tri-state (ver comentário em
      // schemas.ts) — só vira boolean real aqui, na borda HTTP.
      const { hasEscalation, ...rest } = query.data;
      const { rows, total } = await listSupervisionIncidents({
        ...rest,
        hasEscalation: hasEscalation === undefined ? undefined : hasEscalation === 'true',
      });

      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  app.get(
    '/operations/supervision-insights/incidents/:auditLogId',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const params = supervisionIncidentIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const detail = await getSupervisionIncidentDetail(params.data.auditLogId);
      if (!detail) return notFound(reply, 'Incidente de supervisão não encontrado.');

      return { data: detail };
    },
  );

  app.get(
    '/operations/supervision-insights/recurring',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = supervisionInsightsOverviewQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      return { data: await listRecurringIncidents(query.data) };
    },
  );
}
