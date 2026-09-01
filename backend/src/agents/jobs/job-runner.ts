import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentDelegations,
  agentEvents,
  agentJobRuns,
  agentJobs,
  agents,
} from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { recordAutonomousOutcome } from '../autonomy/circuit.js';
import { recordAutonomyBlock } from '../autonomy/dead-letter.js';
import { evaluateAutonomousExecution, resolveCausation, type ResolvedCausation } from '../autonomy/guard.js';
import { runWithLineage } from '../autonomy/lineage-context.js';
import { publishAgentEvent } from '../events/publisher.js';
import { executeActionPlan } from '../executor/action-plan-executor.js';
import { planEvaluateAndPersistActionPlan } from '../orchestration/create-action-plan.js';
import type { AgentErrorCode } from '../errors.js';
import { checkDailyRunLimit, checkOpenApprovalLimit, checkRunConcurrency } from './budget.js';
import { isAutonomousExecutionEnabled } from './global-switch.js';
import { computeNextRunAt } from './schedule.js';
import type { ScheduleConfig, TriggerType } from './schemas.js';

export interface RunTrigger {
  type: TriggerType;
  payload?: unknown;
}

export type RunAgentJobResult =
  | { ok: true; run: typeof agentJobRuns.$inferSelect }
  | { ok: false; run: null; code: AgentErrorCode; message: string };

const TERMINAL_RUN_STATUSES = ['completed', 'partial', 'failed', 'cancelled', 'blocked'];
const ABANDONABLE_RUN_STATUSES = ['queued', 'planning', 'running'];

/**
 * AgentJobRunner (correio.md v1.3 seção 7). Único orquestrador de Jobs —
 * nunca chama tool diretamente, nunca decide policy, nunca aprova: só
 * encadeia planEvaluateAndPersistActionPlan (agents/orchestration/) +
 * executeActionPlan (agents/executor/, o MESMO executor da v1.2). O
 * planejamento sempre roda com as permissions de `job.createdBy` — quem
 * efetivamente dispara o Run (`actingUserId`, manual ou pelo scheduler)
 * nunca eleva nem reduz o que o Job pode fazer (seção 1: "autonomia
 * permite iniciar novamente um processo previamente autorizado, mas nunca
 * concede novas permissões").
 */
export async function runAgentJob(
  jobId: number,
  trigger: RunTrigger,
  actingUserId?: number | null,
  idempotencyKey?: string | null,
): Promise<RunAgentJobResult> {
  const [job] = await db.select().from(agentJobs).where(eq(agentJobs.id, jobId)).limit(1);

  if (!job) {
    return { ok: false, run: null, code: 'job_not_found', message: 'Job não encontrado.' };
  }

  // Idempotência (seção 19) — mesma idempotencyKey para o mesmo Job
  // devolve o Run já existente, nunca cria um novo (retry/duplo clique).
  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(agentJobRuns)
      .where(and(eq(agentJobRuns.jobId, jobId), eq(agentJobRuns.idempotencyKey, idempotencyKey)))
      .limit(1);

    if (existing) {
      return { ok: true, run: existing };
    }
  }

  if (job.status !== 'active') {
    return {
      ok: false,
      run: null,
      code: 'job_not_runnable',
      message: `Job está "${job.status}" — só Jobs "active" podem iniciar um Run.`,
    };
  }

  const [agentRow] = await db.select().from(agents).where(eq(agents.id, job.agentId)).limit(1);

  if (!agentRow || !agentRow.isActive || agentRow.status !== 'active') {
    return {
      ok: false,
      run: null,
      code: 'job_agent_disabled',
      message: 'O agente responsável por este Job está desativado.',
    };
  }

  // Kill switch global (seção 14) — só bloqueia gatilho automático; manual
  // já foi filtrado pela permission da rota.
  if (trigger.type !== 'manual' && !(await isAutonomousExecutionEnabled())) {
    return {
      ok: false,
      run: null,
      code: 'job_autonomy_disabled',
      message: 'Execução autônoma de Jobs está desligada globalmente (agents_autonomous_execution_enabled=false).',
    };
  }

  const actor = actingUserId ?? job.createdBy;

  // Agentes v1.5 (correio.md seção 4) — resolução de causação/depth fora
  // da transação: agent_events nunca é alterado depois de inserido, então
  // ler a linha causadora aqui é seguro (sem risco de leitura obsoleta
  // dentro da janela de decisão) e evita segurar o lock por mais tempo do
  // que o necessário.
  let causingEvent: (typeof agentEvents.$inferSelect) | null = null;

  if (trigger.type === 'internal_event') {
    const payload = trigger.payload as { eventId?: number } | undefined;

    if (payload?.eventId) {
      const [row] = await db.select().from(agentEvents).where(eq(agentEvents.id, payload.eventId)).limit(1);
      causingEvent = row ?? null;
    }
  }

  const preResolvedCausation = resolveCausation(trigger, causingEvent);

  // Lock + budget + governance + criação do Run numa única transação
  // curta (seção 9) — sem Redis lock/advisory lock: o SELECT ... FOR
  // UPDATE cobre a janela de decisão inteira, e o "destravamento" após
  // crash é coberto por recoverAbandonedRuns() no boot (seção 21), não por
  // um TTL de lock.
  //
  // Ordem de lock (seção 23/28, evita deadlock): a linha do Run raiz
  // (quando esta tentativa pertence a uma cadeia já iniciada) é travada
  // ANTES da linha do Job — nenhum outro caminho de código trava
  // agent_job_runs antes de agent_jobs, então essa ordem é sempre
  // consistente. Isso serializa o chain budget/cycle detection entre
  // Jobs diferentes que compartilham a mesma raiz.
  const gate = await db.transaction(async (tx) => {
    if (trigger.type !== 'manual' && preResolvedCausation.rootExecutionId !== null) {
      await tx
        .select({ id: agentJobRuns.id })
        .from(agentJobRuns)
        .where(eq(agentJobRuns.id, preResolvedCausation.rootExecutionId))
        .for('update');
    }

    const [lockedJob] = await tx.select().from(agentJobs).where(eq(agentJobs.id, jobId)).for('update');

    if (!lockedJob || lockedJob.status !== 'active') {
      return {
        ok: false as const,
        autonomyBlocked: false as const,
        code: 'job_not_runnable' as AgentErrorCode,
        message: 'Job não está mais ativo.',
      };
    }

    const concurrency = await checkRunConcurrency(tx, lockedJob);
    if (!concurrency.ok) return { ...concurrency, autonomyBlocked: false as const };

    const dailyLimit = await checkDailyRunLimit(tx, lockedJob);
    if (!dailyLimit.ok) return { ...dailyLimit, autonomyBlocked: false as const };

    const openApprovals = await checkOpenApprovalLimit(tx, lockedJob);
    if (!openApprovals.ok) return { ...openApprovals, autonomyBlocked: false as const };

    // Autonomy Guard (correio.md seção 11) — só para gatilho não-manual;
    // execução manual nunca passa por depth/cycle/budget/rate/circuit
    // (mesmo racional do global switch acima, já checado antes desta
    // transação).
    let causation: ResolvedCausation = preResolvedCausation;

    if (trigger.type !== 'manual') {
      const guardResult = await evaluateAutonomousExecution({ tx, job: lockedJob, trigger, causingEvent });

      if (!guardResult.allowed) {
        return {
          ok: false as const,
          autonomyBlocked: true as const,
          reason: guardResult.reason,
          causation: guardResult.causation,
          limit: guardResult.limit,
          current: guardResult.current,
        };
      }

      causation = guardResult.causation;
    }

    const [insertedRun] = await tx
      .insert(agentJobRuns)
      .values({
        jobId,
        triggerType: trigger.type,
        triggerPayload: trigger.payload ?? null,
        status: 'planning',
        startedAt: new Date(),
        idempotencyKey: idempotencyKey ?? null,
        rootExecutionId: causation.rootExecutionId,
        causationRunId: causation.causationRunId,
        causationEventDeliveryId: (trigger.payload as { deliveryId?: number } | undefined)?.deliveryId ?? null,
        autonomyDepth: causation.autonomyDepth,
      })
      .returning();

    // Raiz nova (causation.rootExecutionId era null): aponta a própria
    // linha para si mesma só depois de saber o id gerado — nunca duas
    // escritas concorrentes disputam isso porque o insert já aconteceu
    // dentro da mesma transação/lock.
    let run = insertedRun;

    if (causation.rootExecutionId === null) {
      const [selfRooted] = await tx
        .update(agentJobRuns)
        .set({ rootExecutionId: run.id })
        .where(eq(agentJobRuns.id, run.id))
        .returning();

      run = selfRooted;
    }

    return { ok: true as const, run };
  });

  if (!gate.ok) {
    if (gate.autonomyBlocked) {
      await recordAutonomyBlock({
        jobId,
        trigger,
        reason: gate.reason,
        causation: gate.causation,
        limit: gate.limit,
        current: gate.current,
      });

      return { ok: false, run: null, code: gate.reason, message: `Execução autônoma bloqueada: ${gate.reason}.` };
    }

    return { ok: false, run: null, code: gate.code, message: gate.message };
  }

  const run = gate.run;

  await audit({
    userId: actor,
    actorType: trigger.type === 'manual' ? 'user' : 'system',
    actorId: String(actor),
    action: 'job_run.created',
    entityType: 'agent_job_run',
    entityId: String(run.id),
    metadata: { jobId, triggerType: trigger.type },
  });

  await audit({
    userId: actor,
    actorType: trigger.type === 'manual' ? 'user' : 'system',
    actorId: String(actor),
    action: 'job_run.started',
    entityType: 'agent_job_run',
    entityId: String(run.id),
    metadata: { jobId },
  });

  const timeoutMs = job.timeoutSeconds * 1000;

  // Agentes v1.5 (correio.md seção 13) — todo o planejamento/execução
  // deste Run roda dentro do contexto de lineage: qualquer evento de
  // negócio publicado por uma tool chamada aqui dentro (ex.:
  // projects.create_internal_task → createInternalTask →
  // publishAgentEvent) é automaticamente carimbado com este Run como
  // causador. Vale para qualquer trigger, inclusive manual — um Run
  // manual também é uma causa real (só a profundidade dele é sempre 0).
  const work = runWithLineage(
    { rootExecutionId: run.rootExecutionId!, causationRunId: run.id, autonomyDepth: run.autonomyDepth },
    () => executeJobRun(job, run.id, actor, trigger.type),
  );

  const raced = await Promise.race([
    work.then((finished) => ({ kind: 'done' as const, run: finished })),
    new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)),
  ]);

  let finalRun = run;

  if (raced.kind === 'timeout') {
    const [updated] = await db
      .update(agentJobRuns)
      .set({
        status: 'failed',
        errorCode: 'job_timeout',
        errorMessage: `Run excedeu timeout_seconds=${job.timeoutSeconds}.`,
        finishedAt: new Date(),
      })
      .where(eq(agentJobRuns.id, run.id))
      .returning();

    finalRun = updated;

    await audit({
      userId: actor,
      actorType: 'system',
      actorId: String(actor),
      action: 'job_run.failed',
      entityType: 'agent_job_run',
      entityId: String(run.id),
      metadata: { code: 'job_timeout', jobId },
    });

    await publishAgentEvent({
      type: 'agent.job.failed',
      aggregateType: 'agent_job_run',
      aggregateId: run.id,
      source: 'agents.jobs.job-runner',
      payload: { jobId, runId: run.id, errorCode: 'job_timeout' },
    });

    // Circuit breaker (correio.md seção 9) — timeout é uma falha real do
    // Run, mas só conta para o circuito autônomo (nunca execução manual,
    // requisito explícito do correio.md). Este é o único caminho de
    // finalização que não passa por syncJobRunStatus (o Run já foi
    // marcado failed diretamente acima), então precisa registrar aqui.
    if (trigger.type !== 'manual') {
      await recordAutonomousOutcome(jobId, 'failed');
    }

    // Trabalho já disparado (tool calls em andamento) não é abortável de
    // forma síncrona nesta versão — segue em segundo plano só para
    // persistir o resultado de cada item; nunca reabre o Run já marcado
    // failed (débito técnico documentado no plano/entrega).
    work.catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[AgentJobRunner] erro em Run já marcado como job_timeout:', error);
    });
  } else {
    finalRun = raced.run ?? finalRun;
  }

  const nextRunAt =
    job.triggerType === 'schedule' && job.scheduleConfig
      ? computeNextRunAt(job.scheduleConfig as ScheduleConfig, new Date())
      : null;

  await db
    .update(agentJobs)
    .set({ lastRunAt: new Date(), nextRunAt, updatedAt: new Date() })
    .where(eq(agentJobs.id, jobId));

  return { ok: true, run: finalRun };
}

async function executeJobRun(
  job: typeof agentJobs.$inferSelect,
  runId: number,
  actor: number,
  triggerType: TriggerType,
): Promise<typeof agentJobRuns.$inferSelect> {
  const created = await planEvaluateAndPersistActionPlan({
    requestedBy: job.createdBy,
    objective: job.objective,
    jobRunId: runId,
    maxActions: job.maxActionsPerRun,
    shadowMode: job.shadowMode,
  });

  if (!created.ok) {
    const code: AgentErrorCode = created.code === 'plan_too_large' ? 'job_action_limit_exceeded' : created.code;

    const [updated] = await db
      .update(agentJobRuns)
      .set({ status: 'failed', errorCode: code, errorMessage: created.message, finishedAt: new Date() })
      .where(eq(agentJobRuns.id, runId))
      .returning();

    await audit({
      userId: actor,
      actorType: 'system',
      actorId: String(actor),
      action: 'job_run.failed',
      entityType: 'agent_job_run',
      entityId: String(runId),
      metadata: { code, message: created.message, jobId: job.id },
    });

    await publishAgentEvent({
      type: 'agent.job.failed',
      aggregateType: 'agent_job_run',
      aggregateId: runId,
      source: 'agents.jobs.job-runner',
      payload: { jobId: job.id, runId, errorCode: code },
    });

    // Este é um caminho de finalização terminal que nunca passa por
    // syncJobRunStatus (o Run já nasceu 'planning' e falhou antes mesmo de
    // ter um Action Plan) — precisa registrar o circuito aqui, mesmo
    // racional do branch de timeout em runAgentJob.
    if (triggerType !== 'manual') {
      await recordAutonomousOutcome(job.id, 'failed');
    }

    return updated;
  }

  await db.update(agentJobRuns).set({ actionPlanId: created.plan.id }).where(eq(agentJobRuns.id, runId));

  await recordDelegations(job, created.items, runId, actor);

  await executeActionPlan(created.plan.id, job.createdBy);

  const synced = await syncJobRunStatus(created.plan.id, actor);

  const [current] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, runId)).limit(1);

  return synced ?? current;
}

// Delegação (seção 11) — profundidade sempre 1 por construção: a origem
// é sempre `job.agentId` (o agente dono do Job), nunca o targetAgentId de
// outra delegação. Não é transferência de autoridade: a Policy Evaluator
// já reavaliou cada item usando as permissions de job.createdBy, nunca as
// do agente pai — este registro é só o rastro estrutural/auditável do
// "Director → Specialist".
async function recordDelegations(
  job: typeof agentJobs.$inferSelect,
  items: (typeof agentActionPlanItems.$inferSelect)[],
  runId: number,
  actor: number,
): Promise<void> {
  const distinctTargets = new Set(items.map((item) => item.agentId).filter((agentId) => agentId !== job.agentId));

  for (const targetAgentId of distinctTargets) {
    const [row] = await db
      .insert(agentDelegations)
      .values({ parentAgentId: job.agentId, targetAgentId, jobRunId: runId, objective: job.objective })
      .returning();

    await audit({
      userId: actor,
      actorType: 'system',
      actorId: String(actor),
      action: 'agent.delegated',
      entityType: 'agent_delegation',
      entityId: String(row.id),
      metadata: { jobRunId: runId, parentAgentId: job.agentId, targetAgentId },
    });
  }
}

// Refinamento de status só do Run (correio.md v1.3 seção 10) — NUNCA
// altera agents/executor/action-plan-executor.ts:finalizePlanStatus, cujo
// comportamento (inclusive o caso "tudo blocked" lendo como 'completed'
// no Plan) já tem teste v1.2 fixando-o. `blocked` aqui é só uma leitura
// adicional sobre os mesmos itens, exclusiva do Run.
function mapPlanStatusToRunStatus(
  planStatus: string,
  items: (typeof agentActionPlanItems.$inferSelect)[],
): string {
  if (planStatus === 'waiting_approval') {
    return 'waiting_approval';
  }

  // Nenhum item chegou a completar (tudo blocked/rejected/skipped) —
  // leitura mais honesta para o Run do que "completed" (que é o que
  // finalizePlanStatus dá ao Plan nesse caso, comportamento v1.2
  // preservado e já coberto por teste — não alterado aqui).
  const noneCompleted = !items.some((item) => item.executionStatus === 'completed');
  const allNonRunnable =
    items.length > 0 && items.every((item) => ['blocked', 'rejected', 'skipped'].includes(item.executionStatus));

  if (noneCompleted && allNonRunnable) {
    return 'blocked';
  }

  if (planStatus === 'completed' || planStatus === 'partial' || planStatus === 'failed') {
    return planStatus;
  }

  return 'running';
}

/**
 * Sincroniza o Run vinculado a um plano a partir do estado atual do
 * plano+itens (correio.md v1.3 seção 10) — chamada tanto ao final da
 * execução inicial do Run (executeJobRun) quanto por
 * agents/executor/plan-approvals.ts após aprovação/rejeição de um item.
 * No-op quando o plano não pertence a nenhum Job (jobRunId null) — plano
 * "solto" da v1.2 nunca ganha um Run para sincronizar.
 */
export async function syncJobRunStatus(
  planId: number,
  actorUserId?: number | null,
): Promise<(typeof agentJobRuns.$inferSelect) | null> {
  const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, planId)).limit(1);

  if (!plan || !plan.jobRunId) {
    return null;
  }

  const [currentRun] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, plan.jobRunId)).limit(1);

  if (!currentRun) {
    return null;
  }

  // Nunca regride um Run já terminal (ex.: já marcado failed:job_timeout)
  // de volta para um status "mais otimista" vindo de um replanejamento
  // tardio.
  if (TERMINAL_RUN_STATUSES.includes(currentRun.status)) {
    return currentRun;
  }

  const items = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, planId));
  const nextStatus = mapPlanStatusToRunStatus(plan.status, items);

  if (nextStatus === currentRun.status) {
    return currentRun;
  }

  const isTerminal = TERMINAL_RUN_STATUSES.includes(nextStatus);

  const [updated] = await db
    .update(agentJobRuns)
    .set({ status: nextStatus, finishedAt: isTerminal ? new Date() : null })
    .where(eq(agentJobRuns.id, currentRun.id))
    .returning();

  if (isTerminal) {
    const action = nextStatus === 'failed' ? 'job_run.failed' : nextStatus === 'blocked' ? 'job_run.blocked' : 'job_run.completed';

    await audit({
      userId: actorUserId ?? null,
      actorType: actorUserId ? 'user' : 'system',
      actorId: actorUserId ? String(actorUserId) : null,
      action,
      entityType: 'agent_job_run',
      entityId: String(updated.id),
      metadata: { planId, status: nextStatus },
    });

    // Agentes v1.4 (correio.md seção 3) — só 'completed'/'failed' têm
    // evento no catálogo; 'partial'/'blocked'/'cancelled' não têm entrada
    // própria nesta versão (nunca inventar evento fora do catálogo).
    if (nextStatus === 'completed') {
      await publishAgentEvent({
        type: 'agent.job.completed',
        aggregateType: 'agent_job_run',
        aggregateId: updated.id,
        source: 'agents.jobs.job-runner',
        payload: { jobId: updated.jobId, runId: updated.id },
      });
    } else if (nextStatus === 'failed') {
      await publishAgentEvent({
        type: 'agent.job.failed',
        aggregateType: 'agent_job_run',
        aggregateId: updated.id,
        source: 'agents.jobs.job-runner',
        payload: { jobId: updated.jobId, runId: updated.id, errorCode: updated.errorCode },
      });
    }

    // Circuit breaker (correio.md seção 9) — cobre tanto o fim "normal"
    // (chamado de dentro de executeJobRun) quanto o fim assíncrono via
    // aprovação (agents/executor/plan-approvals.ts chama esta mesma
    // função). Só 'completed'/'failed' são veredito limpo o suficiente
    // para mover o circuito (decisão documentada em
    // agents/autonomy/circuit.ts); 'blocked' fica neutro. Nunca conta
    // execução manual.
    if (currentRun.triggerType !== 'manual' && (nextStatus === 'completed' || nextStatus === 'failed')) {
      await recordAutonomousOutcome(updated.jobId, nextStatus);
    }
  }

  return updated;
}

/**
 * Recovery após restart (correio.md v1.3 seção 21) — chamada uma única
 * vez no boot (server.ts, nunca em buildApp()/testes): Runs abandonados
 * em queued/planning/running há mais tempo que o timeout_seconds do
 * respectivo Job viram failed:run_interrupted. `waiting_approval` nunca é
 * tocado.
 */
export async function recoverAbandonedRuns(): Promise<number> {
  const staleCandidates = await db
    .select({ run: agentJobRuns, timeoutSeconds: agentJobs.timeoutSeconds })
    .from(agentJobRuns)
    .innerJoin(agentJobs, eq(agentJobRuns.jobId, agentJobs.id))
    .where(inArray(agentJobRuns.status, ABANDONABLE_RUN_STATUSES));

  const now = Date.now();
  let recovered = 0;

  for (const { run, timeoutSeconds } of staleCandidates) {
    const reference = run.startedAt ?? run.createdAt;

    if (now - reference.getTime() <= timeoutSeconds * 1000) {
      continue;
    }

    await db
      .update(agentJobRuns)
      .set({
        status: 'failed',
        errorCode: 'run_interrupted',
        errorMessage: 'Run abandonado detectado na inicialização do processo (provável reinício/crash).',
        finishedAt: new Date(),
      })
      .where(eq(agentJobRuns.id, run.id));

    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'job_run.failed',
      entityType: 'agent_job_run',
      entityId: String(run.id),
      metadata: { code: 'run_interrupted' },
    });

    recovered += 1;
  }

  return recovered;
}
