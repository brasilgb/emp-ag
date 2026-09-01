import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, desc, eq, gte, ne } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentJobRuns, agentJobs, agents } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { AgentError } from '../../agents/errors.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/require-permission.js';
import { runAgentJob } from '../../agents/jobs/job-runner.js';
import { computeNextRunAt } from '../../agents/jobs/schedule.js';
import {
  createJobSchema,
  jobIdParamSchema,
  listJobRunsQuerySchema,
  listJobsQuerySchema,
  runJobSchema,
  setJobAutonomySchema,
  updateJobSchema,
} from '../../agents/jobs/schemas.js';
import type { ScheduleConfig } from '../../agents/jobs/schemas.js';
import { audit } from '../../services/audit.js';
import { publishAgentEvent } from '../../agents/events/publisher.js';

import { badRequest, currentUserId, notFound, paginationMeta } from './helpers.js';

// Agentes v1.5 (correio.md seção 21) — resumo de governance exibido no
// painel do Job. Consulta pontual/indexada (agent_job_runs_job_trigger_created_idx),
// nunca reconstrução de árvore — mesma janela/precedência usada pelo
// Autonomy Guard (agents/autonomy/guard.ts), só para leitura aqui.
async function withAutonomyGovernance(job: typeof agentJobs.$inferSelect) {
  const rateLimit = job.autonomyRateLimitOverride ?? env.AGENT_JOB_AUTONOMY_RATE_LIMIT;
  const rateWindowSeconds = job.autonomyRateWindowOverrideSeconds ?? env.AGENT_JOB_AUTONOMY_RATE_WINDOW_SECONDS;
  const windowStart = new Date(Date.now() - rateWindowSeconds * 1000);

  const [{ total: autonomousRunsInWindow }] = await db
    .select({ total: count() })
    .from(agentJobRuns)
    .where(and(eq(agentJobRuns.jobId, job.id), ne(agentJobRuns.triggerType, 'manual'), gte(agentJobRuns.createdAt, windowStart)));

  return {
    ...job,
    governance: {
      autonomyRateLimit: rateLimit,
      autonomyRateWindowSeconds: rateWindowSeconds,
      autonomousRunsInWindow,
      maxAutonomyDepth: env.AGENT_MAX_AUTONOMY_DEPTH,
      maxRunsPerAutonomyChain: env.AGENT_MAX_RUNS_PER_AUTONOMY_CHAIN,
      circuitFailureThreshold: env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD,
      circuitCooldownSeconds: env.AGENT_AUTONOMY_CIRCUIT_COOLDOWN_SECONDS,
    },
  };
}

/**
 * Agentes v1.3 — Jobs (correio.md seção 15). Exatamente os endpoints
 * listados: POST/GET/PATCH em /jobs, pause/resume/cancel/run como ações
 * dedicadas (nunca PATCH de status), GET /jobs/:id/runs — a lista de Runs
 * fica em jobs.ts por reaproveitar o mesmo :id; GET /job-runs/:id é
 * registrado à parte em job-runs.ts (rota irmã, fora do prefixo :id de
 * Job).
 */
export async function jobsRoutes(app: FastifyInstance) {
  app.post(
    '/jobs',
    { preHandler: [authenticate, requirePermission('agents.jobs.create')] },
    async (request, reply) => {
      const body = createJobSchema.safeParse(request.body);

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [agentRow] = await db.select().from(agents).where(eq(agents.slug, body.data.agentSlug)).limit(1);

      if (!agentRow) {
        const agentError = new AgentError('agent_not_found', `Agente inexistente: "${body.data.agentSlug}".`);
        return reply.code(agentError.status).send({ error: agentError.code, message: agentError.message });
      }

      const userId = currentUserId(request);

      const nextRunAt =
        body.data.triggerType === 'schedule' && body.data.scheduleConfig
          ? computeNextRunAt(body.data.scheduleConfig)
          : null;

      const [job] = await db
        .insert(agentJobs)
        .values({
          name: body.data.name,
          description: body.data.description ?? null,
          objective: body.data.objective,
          agentId: agentRow.id,
          createdBy: userId,
          status: 'active',
          triggerType: body.data.triggerType,
          scheduleConfig: body.data.scheduleConfig ?? null,
          eventConfig: body.data.eventConfig ?? null,
          maxRunsPerDay: body.data.maxRunsPerDay,
          maxActionsPerRun: body.data.maxActionsPerRun,
          maxOpenApprovals: body.data.maxOpenApprovals,
          timeoutSeconds: body.data.timeoutSeconds,
          shadowMode: body.data.shadowMode,
          allowConcurrentRuns: body.data.allowConcurrentRuns,
          nextRunAt,
        })
        .returning();

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'job.created',
        entityType: 'agent_job',
        entityId: String(job.id),
        metadata: { name: job.name, triggerType: job.triggerType },
      });

      await publishAgentEvent({
        type: 'agent.job.created',
        aggregateType: 'agent_job',
        aggregateId: job.id,
        source: 'agents.jobs',
        payload: { jobId: job.id, agentId: job.agentId, triggerType: job.triggerType },
      });

      return reply.code(201).send({ data: job });
    },
  );

  app.get(
    '/jobs',
    { preHandler: [authenticate, requirePermission('agents.jobs.read')] },
    async (request, reply) => {
      const query = listJobsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const { page, limit, status } = query.data;
      const where = status ? eq(agentJobs.status, status) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(agentJobs)
          .where(where)
          .orderBy(desc(agentJobs.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentJobs).where(where),
      ]);

      return { data: rows, pagination: paginationMeta({ page, limit, total }) };
    },
  );

  app.get(
    '/jobs/:id',
    { preHandler: [authenticate, requirePermission('agents.jobs.read')] },
    async (request, reply) => {
      const params = jobIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, params.data.id)).limit(1);

      if (!job) {
        return notFound(reply, 'Job não encontrado.');
      }

      return { data: await withAutonomyGovernance(job) };
    },
  );

  app.patch(
    '/jobs/:id',
    { preHandler: [authenticate, requirePermission('agents.jobs.update')] },
    async (request, reply) => {
      const params = jobIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = updateJobSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, params.data.id)).limit(1);

      if (!job) {
        return notFound(reply, 'Job não encontrado.');
      }

      const effectiveTriggerType = body.data.triggerType ?? job.triggerType;
      const effectiveScheduleConfig =
        (body.data.scheduleConfig as ScheduleConfig | undefined) ?? (job.scheduleConfig as ScheduleConfig | null) ?? null;

      const nextRunAt =
        effectiveTriggerType === 'schedule' && effectiveScheduleConfig
          ? computeNextRunAt(effectiveScheduleConfig)
          : null;

      const [updated] = await db
        .update(agentJobs)
        .set({
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          ...(body.data.description !== undefined ? { description: body.data.description } : {}),
          ...(body.data.objective !== undefined ? { objective: body.data.objective } : {}),
          ...(body.data.triggerType !== undefined ? { triggerType: body.data.triggerType } : {}),
          ...(body.data.scheduleConfig !== undefined ? { scheduleConfig: body.data.scheduleConfig } : {}),
          ...(body.data.eventConfig !== undefined ? { eventConfig: body.data.eventConfig } : {}),
          ...(body.data.shadowMode !== undefined ? { shadowMode: body.data.shadowMode } : {}),
          ...(body.data.allowConcurrentRuns !== undefined ? { allowConcurrentRuns: body.data.allowConcurrentRuns } : {}),
          ...(body.data.maxRunsPerDay !== undefined ? { maxRunsPerDay: body.data.maxRunsPerDay } : {}),
          ...(body.data.maxActionsPerRun !== undefined ? { maxActionsPerRun: body.data.maxActionsPerRun } : {}),
          ...(body.data.maxOpenApprovals !== undefined ? { maxOpenApprovals: body.data.maxOpenApprovals } : {}),
          ...(body.data.timeoutSeconds !== undefined ? { timeoutSeconds: body.data.timeoutSeconds } : {}),
          ...(body.data.triggerType !== undefined ? { nextRunAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(agentJobs.id, job.id))
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'job.updated',
        entityType: 'agent_job',
        entityId: String(job.id),
        metadata: { fields: Object.keys(body.data) },
      });

      return { data: updated };
    },
  );

  app.post(
    '/jobs/:id/run',
    { preHandler: [authenticate, requirePermission('agents.jobs.run')] },
    async (request, reply) => {
      const params = jobIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = runJobSchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const userId = currentUserId(request);

      const result = await runAgentJob(params.data.id, { type: 'manual' }, userId, body.data.idempotencyKey ?? null);

      if (!result.ok) {
        const agentError = new AgentError(result.code, result.message);
        return reply.code(agentError.status).send({ error: agentError.code, message: agentError.message });
      }

      return reply.code(202).send({ data: result.run });
    },
  );

  app.post(
    '/jobs/:id/pause',
    { preHandler: [authenticate, requirePermission('agents.jobs.manage')] },
    async (request, reply) => transitionJobStatus(request, reply, { from: ['active'], to: 'paused', auditAction: 'job.paused' }),
  );

  app.post(
    '/jobs/:id/resume',
    { preHandler: [authenticate, requirePermission('agents.jobs.manage')] },
    async (request, reply) => transitionJobStatus(request, reply, { from: ['paused'], to: 'active', auditAction: 'job.resumed' }),
  );

  app.post(
    '/jobs/:id/cancel',
    { preHandler: [authenticate, requirePermission('agents.jobs.manage')] },
    async (request, reply) =>
      transitionJobStatus(request, reply, { from: ['draft', 'active', 'paused'], to: 'cancelled', auditAction: 'job.cancelled' }),
  );

  // Agentes v1.5 (correio.md seção 10/18) — kill switch granular por Job.
  // Endpoint dedicado, mesmo padrão de pause/resume/cancel acima; nunca
  // altera o global switch (agents/jobs/global-switch.ts, tabela
  // `settings`, seu próprio endpoint em agents/index.ts).
  app.patch(
    '/jobs/:id/autonomy',
    { preHandler: [authenticate, requirePermission('agents.jobs.manage')] },
    async (request, reply) => {
      const params = jobIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const body = setJobAutonomySchema.safeParse(request.body ?? {});

      if (!body.success) {
        return badRequest(reply, body.error);
      }

      const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, params.data.id)).limit(1);

      if (!job) {
        return notFound(reply, 'Job não encontrado.');
      }

      const [updated] = await db
        .update(agentJobs)
        .set({ autonomyEnabled: body.data.enabled, updatedAt: new Date() })
        .where(eq(agentJobs.id, job.id))
        .returning();

      const userId = currentUserId(request);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: body.data.enabled ? 'agent_autonomy.job_enabled' : 'agent_autonomy.job_disabled',
        entityType: 'agent_job',
        entityId: String(job.id),
        metadata: { previous: job.autonomyEnabled, next: body.data.enabled },
      });

      return { data: await withAutonomyGovernance(updated) };
    },
  );

  app.get(
    '/jobs/:id/runs',
    { preHandler: [authenticate, requirePermission('agents.runs.read')] },
    async (request, reply) => {
      const params = jobIdParamSchema.safeParse(request.params);

      if (!params.success) {
        return badRequest(reply, params.error);
      }

      const query = listJobRunsQuerySchema.safeParse(request.query);

      if (!query.success) {
        return badRequest(reply, query.error);
      }

      const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, params.data.id)).limit(1);

      if (!job) {
        return notFound(reply, 'Job não encontrado.');
      }

      const { page, limit, status } = query.data;
      const where = status
        ? and(eq(agentJobRuns.jobId, job.id), eq(agentJobRuns.status, status))
        : eq(agentJobRuns.jobId, job.id);

      const [rows, [{ total }]] = await Promise.all([
        db
          .select()
          .from(agentJobRuns)
          .where(where)
          .orderBy(desc(agentJobRuns.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(agentJobRuns).where(where),
      ]);

      return { data: rows, pagination: paginationMeta({ page, limit, total }) };
    },
  );
}

async function transitionJobStatus(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { from: string[]; to: string; auditAction: string },
) {
  const params = jobIdParamSchema.safeParse(request.params);

  if (!params.success) {
    return badRequest(reply, params.error);
  }

  const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, params.data.id)).limit(1);

  if (!job) {
    return notFound(reply, 'Job não encontrado.');
  }

  if (!options.from.includes(job.status)) {
    const agentError = new AgentError(
      'job_not_runnable',
      `Job está "${job.status}" — transição para "${options.to}" só é permitida a partir de: ${options.from.join(', ')}.`,
    );

    return reply.code(agentError.status).send({ error: agentError.code, message: agentError.message });
  }

  const [updated] = await db
    .update(agentJobs)
    .set({ status: options.to, updatedAt: new Date() })
    .where(eq(agentJobs.id, job.id))
    .returning();

  const userId = currentUserId(request);

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: options.auditAction,
    entityType: 'agent_job',
    entityId: String(job.id),
    metadata: { fromStatus: job.status, toStatus: options.to },
  });

  return { data: updated };
}
