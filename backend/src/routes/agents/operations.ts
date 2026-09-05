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
  attentionQueueQuerySchema,
  listSupervisionIncidentsQuerySchema,
  listSupervisionRunsQuerySchema,
  operationsSummaryQuerySchema,
  patchSupervisionSchedulerSchema,
  slaAnalyticsQuerySchema,
  supervisionIncidentIdParamSchema,
  supervisionInsightsOverviewQuerySchema,
  supervisionRunIdParamSchema,
  superviseQuerySchema,
  updateIncidentAssignmentSchema,
  updateIncidentReviewSchema,
  updateSlaSettingsSchema,
} from '../../agents/operations/schemas.js';
import { getOperationalHealth } from '../../agents/operations/health-service.js';
import { getIncidentReview, upsertIncidentReview } from '../../agents/operations/incident-review-service.js';
import { assignIncident, getIncidentAssignment, unassignIncident } from '../../agents/operations/incident-assignment-service.js';
import { getOperationalSlaMinutesBySeverity, setOperationalSlaMinutesBySeverity } from '../../agents/operations/sla-settings.js';
import { getOperationalSupervisionSchedulerStatus } from '../../agents/operations/scheduler-status.js';
import { isOperationalSupervisionEnabled, setOperationalSupervisionEnabled } from '../../agents/operations/scheduler-settings.js';
import { SupervisionAlreadyRunningError } from '../../agents/operations/supervisor-guard.js';
import { getSupervisionRunById, listSupervisionRuns, runObservedOperationalSupervision } from '../../agents/operations/supervision-run-history.js';
import { getOperationalOwnershipWorkload, getSupervisionIncidentDetail, getSupervisionOverview, listAttentionQueue, listRecurringIncidents, listSupervisionIncidents } from '../../agents/operations/supervision-insights-service.js';
import { getOperationalSlaAnalytics } from '../../agents/operations/sla-analytics-service.js';
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

      // `hasEscalation`/`recurringOnly` deliberadamente tri-state (ver
      // comentário em schemas.ts) — só viram boolean real aqui, na borda
      // HTTP.
      const { hasEscalation, recurringOnly, ...rest } = query.data;
      const { rows, total } = await listSupervisionIncidents({
        ...rest,
        hasEscalation: hasEscalation === undefined ? undefined : hasEscalation === 'true',
        recurringOnly: recurringOnly === undefined ? undefined : recurringOnly === 'true',
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

  // Agentes v3.6 (correio.md "Operational Incident Acknowledgement &
  // Review Workflow") — leitura reaproveita `agents.operations.read`
  // (mesma permission de toda esta seção); escrita reaproveita
  // `agents.operations.manage` (mesma permission já usada por
  // `POST /operations/supervise` e `PATCH /operations/scheduler` acima —
  // nenhuma permission nova criada, seção 6 do correio.md: "revisar as
  // permissões existentes" antes de inventar uma).
  app.get(
    '/operations/supervision-insights/incidents/:auditLogId/review',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const params = supervisionIncidentIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const review = await getIncidentReview(params.data.auditLogId);
      if (!review) return notFound(reply, 'Incidente de supervisão não encontrado.');

      return { data: review };
    },
  );

  app.patch(
    '/operations/supervision-insights/incidents/:auditLogId/review',
    { preHandler: [authenticate, requirePermission('agents.operations.manage')] },
    async (request, reply) => {
      const params = supervisionIncidentIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = updateIncidentReviewSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      // `reviewedBy`/`reviewedAt` SEMPRE derivados do servidor (correio.md
      // seção 5) — nunca aceitos do payload (o schema `.strict()` já
      // rejeitaria, mas a fonte real também nunca lê nada do body além de
      // `status`/`note`).
      const result = await upsertIncidentReview(params.data.auditLogId, currentUserId(request), body.data);
      if (!result.ok) return notFound(reply, 'Incidente de supervisão não encontrado.');

      return { data: result.review };
    },
  );

  // Agentes v3.8 (correio.md "Operational Incident Ownership &
  // Assignment") — leitura reaproveita `agents.operations.read`; escrita
  // (assign/reassign/unassign) reaproveita `agents.operations.manage` —
  // mesma semântica já usada pelo review acima (seção 8: "read → pode
  // ver assignment; manage → pode assign/reassign/unassign"). Nenhuma
  // permission nova. `PATCH` cobre assign E reassign (seção 9:
  // "reassignment pode ser consequência natural de assignIncident") —
  // nunca endpoints redundantes (`/assign`, `/reassign`, `/take`,
  // `/claim`). `DELETE` cobre unassign — este projeto nunca usa `PUT`
  // (confirmado: nenhum `app.put` existe no backend inteiro), então o
  // par PATCH/DELETE é a semântica REST já estabelecida aqui, preferida
  // à sugestão literal do correio.md (que já permitia "ou outra
  // semântica REST já usada pelo projeto").
  app.get(
    '/operations/supervision-insights/incidents/:auditLogId/assignment',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const params = supervisionIncidentIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const assignment = await getIncidentAssignment(params.data.auditLogId);
      if (!assignment) return notFound(reply, 'Incidente de supervisão não encontrado.');

      return { data: assignment };
    },
  );

  app.patch(
    '/operations/supervision-insights/incidents/:auditLogId/assignment',
    { preHandler: [authenticate, requirePermission('agents.operations.manage')] },
    async (request, reply) => {
      const params = supervisionIncidentIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const body = updateIncidentAssignmentSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      // `assignedBy`/`assignedAt` SEMPRE derivados do servidor (mesmo
      // padrão do review, seção 5 da v3.6) — nunca aceitos do payload.
      const result = await assignIncident(params.data.auditLogId, body.data.assigneeUserId, currentUserId(request));
      if (!result.ok) {
        if (result.code === 'invalid_incident') return notFound(reply, 'Incidente de supervisão não encontrado.');
        // `invalid_assignee` — mesmo formato de resposta de `badRequest`
        // (helpers.ts), mas sem um ZodError para passar (a validação de
        // elegibilidade do assignee acontece no service, não no schema).
        return reply.code(400).send({ error: 'invalid_request', message: 'Usuário informado não existe.' });
      }

      return { data: result.assignment };
    },
  );

  app.delete(
    '/operations/supervision-insights/incidents/:auditLogId/assignment',
    { preHandler: [authenticate, requirePermission('agents.operations.manage')] },
    async (request, reply) => {
      const params = supervisionIncidentIdParamSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);

      const result = await unassignIncident(params.data.auditLogId, currentUserId(request));
      if (!result.ok) return notFound(reply, 'Incidente de supervisão não encontrado.');

      return { data: result.assignment };
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

  // Agentes v3.7 (correio.md "Operational Incident Review Queue &
  // Attention Management") — fila "Needs Attention". Endpoint DEDICADO
  // (não uma extensão de `/incidents` acima): o default de exclusão de
  // `resolved`/`dismissed` e a ordenação por prioridade são
  // responsabilidades diferentes de "histórico paginado por data" — mas
  // reaproveita 100% da mesma infraestrutura de enriquecimento/filtro
  // (`listAttentionQueue` chama a MESMA `enrichIncidentRows` interna de
  // `listSupervisionIncidents`, ver supervision-insights-service.ts).
  // Mesma permission de leitura de toda esta seção — a fila é só
  // leitura; ações (acknowledge/resolve/dismiss) continuam
  // exclusivamente no workflow de review da v3.6 acima
  // (`agents.operations.manage`), nenhuma ação nova introduzida.
  app.get(
    '/operations/supervision-insights/needs-attention',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = attentionQueueQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      const { recurringOnly, unassignedOnly, ...rest } = query.data;
      const { rows, total } = await listAttentionQueue({
        ...rest,
        recurringOnly: recurringOnly === undefined ? undefined : recurringOnly === 'true',
        unassignedOnly: unassignedOnly === undefined ? undefined : unassignedOnly === 'true',
      });

      return { data: rows, pagination: paginationMeta({ page: query.data.page, limit: query.data.limit, total }) };
    },
  );

  // Agentes v3.9 (correio.md "Operational Ownership Workload & Human
  // Coordination Views") — leitura consolidada de ownership. Mesma
  // permission de leitura de toda esta seção (`agents.operations.read`);
  // nunca exige `agents.operations.manage` (correio.md seção 5: "o
  // endpoint deve ser estritamente read-only") — sem query params, sem
  // corpo, sem mutação/audit alguma (testado explicitamente).
  app.get(
    '/operations/supervision-insights/ownership-workload',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async () => ({ data: await getOperationalOwnershipWorkload() }),
  );

  // Agentes v4.1 (correio.md "Operational Incident Aging & SLA
  // Visibility", seções 3/12/13) — configuração pequena e fechada (só
  // minutos por severidade, reaproveitando a tabela genérica `settings`
  // — ver docblock de `sla-settings.ts`). Leitura em
  // `agents.operations.read` (mesma de toda esta seção — "não criar
  // permission nova apenas para visualizar informação derivada de um
  // incidente que o usuário já pode consultar"); escrita em
  // `agents.operations.manage` (mesma permission já usada por
  // `PATCH /operations/scheduler` acima — "permission administrativa/
  // gerencial já adequada", nenhuma nova). Cada alteração é auditada
  // dentro do próprio `setOperationalSlaMinutesBySeverity`; leitura
  // nunca gera audit log (seção 13).
  app.get(
    '/operations/sla-settings',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async () => ({ data: await getOperationalSlaMinutesBySeverity() }),
  );

  app.patch(
    '/operations/sla-settings',
    { preHandler: [authenticate, requirePermission('agents.operations.manage')] },
    async (request, reply) => {
      const body = updateSlaSettingsSchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);

      const result = await setOperationalSlaMinutesBySeverity(body.data, currentUserId(request));
      if (!result.ok) return reply.code(400).send({ error: 'invalid_request', message: result.message });

      return { data: result.value };
    },
  );

  // Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
  // Visibility") — camada agregada de leitura sobre v3.5/v3.6/v3.8/v4.1
  // (ver docblock de discovery em sla-analytics-service.ts). Mesma
  // permission de leitura de TODA esta seção (`agents.operations.read`) —
  // "a permissão... é suficiente para leitura" (seção 21); 100% read-only,
  // nenhum audit log é gravado por esta rota (seção 14/21).
  app.get(
    '/operations/sla-analytics',
    { preHandler: [authenticate, requirePermission('agents.operations.read')] },
    async (request, reply) => {
      const query = slaAnalyticsQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);

      // Default de 7 dias quando omitido — mesmo padrão de
      // `GET /operations/summary` (v1.6) — a resposta sempre ecoa o
      // período EXATO resolvido em `data.period`, nunca deixando o
      // cliente sem saber qual janela foi usada.
      const to = query.data.to ?? new Date();
      const from = query.data.from ?? new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

      return { data: await getOperationalSlaAnalytics({ from, to, severity: query.data.severity }) };
    },
  );
}
