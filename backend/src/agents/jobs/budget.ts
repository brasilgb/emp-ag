import { and, count, eq, gte, inArray } from 'drizzle-orm';

import type { Tx } from '../../routes/agents/helpers.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
  agentJobRuns,
  agentJobs,
} from '../../db/schema/index.js';
import type { AgentErrorCode } from '../errors.js';

// Runs "em andamento" para efeito de concorrência (correio.md seção 9) —
// qualquer status que ainda não é terminal.
export const ACTIVE_RUN_STATUSES = ['queued', 'planning', 'running', 'waiting_approval'] as const;

export type BudgetCheckResult = { ok: true } | { ok: false; code: AgentErrorCode; message: string };

const ok: BudgetCheckResult = { ok: true };

/**
 * Concorrência (seção 9): dentro da MESMA transação que já tem a linha do
 * Job travada (`SELECT ... FOR UPDATE`, feito por quem chama esta
 * função), conta Runs ativos deste Job. `allow_concurrent_runs=false` e
 * já existir um ativo → bloqueia sem criar linha nenhuma.
 */
export async function checkRunConcurrency(
  tx: Tx,
  job: typeof agentJobs.$inferSelect,
): Promise<BudgetCheckResult> {
  if (job.allowConcurrentRuns) {
    return ok;
  }

  const [active] = await tx
    .select({ id: agentJobRuns.id })
    .from(agentJobRuns)
    .where(and(eq(agentJobRuns.jobId, job.id), inArray(agentJobRuns.status, [...ACTIVE_RUN_STATUSES])))
    .limit(1);

  if (active) {
    return {
      ok: false,
      code: 'job_run_already_active',
      message: 'Já existe um Run ativo para este Job e allow_concurrent_runs está desligado.',
    };
  }

  return ok;
}

/** max_runs_per_day (seção 8) — conta Runs criados desde 00:00 UTC de hoje. */
export async function checkDailyRunLimit(tx: Tx, job: typeof agentJobs.$inferSelect): Promise<BudgetCheckResult> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [{ total }] = await tx
    .select({ total: count() })
    .from(agentJobRuns)
    .where(and(eq(agentJobRuns.jobId, job.id), gte(agentJobRuns.createdAt, startOfDay)));

  if (total >= job.maxRunsPerDay) {
    return {
      ok: false,
      code: 'job_run_limit_exceeded',
      message: `Limite diário de execuções atingido (max_runs_per_day=${job.maxRunsPerDay}).`,
    };
  }

  return ok;
}

/**
 * max_open_approvals (seção 8) — conta aprovações `pending` cujos itens
 * pertencem a Action Plans de Runs deste Job (join
 * agent_approvals → agent_action_plan_items → agent_action_plans →
 * agent_job_runs).
 */
export async function checkOpenApprovalLimit(tx: Tx, job: typeof agentJobs.$inferSelect): Promise<BudgetCheckResult> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(agentApprovals)
    .innerJoin(agentActionPlanItems, eq(agentApprovals.planItemId, agentActionPlanItems.id))
    .innerJoin(agentActionPlans, eq(agentActionPlanItems.planId, agentActionPlans.id))
    .innerJoin(agentJobRuns, eq(agentActionPlans.jobRunId, agentJobRuns.id))
    .where(and(eq(agentJobRuns.jobId, job.id), eq(agentApprovals.status, 'pending')));

  if (total >= job.maxOpenApprovals) {
    return {
      ok: false,
      code: 'job_open_approval_limit_exceeded',
      message: `Limite de aprovações abertas atingido (max_open_approvals=${job.maxOpenApprovals}).`,
    };
  }

  return ok;
}
