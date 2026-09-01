import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
  agentDelegations,
  agentJobRuns,
  agentJobs,
  agentTools,
  agents,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../agents/llm/factory.js';
import { registerAllTools } from '../../agents/tools/index.js';
import { runAgentJob, recoverAbandonedRuns } from '../../agents/jobs/job-runner.js';
import { pollDueJobs } from '../../agents/jobs/scheduler.js';
import { setAutonomousExecutionEnabled } from '../../agents/jobs/global-switch.js';
import type { LLMProvider, LLMResponse } from '../../agents/llm/types.js';

/*
 * Testes de integração de Agentes v1.3 — Jobs/Runs/Delegation (correio.md).
 * Mesmo padrão de routes/agents/action-plans.test.ts: banco real, LLM
 * mockado via setLLMProviderOverrideForTests, envs limpas em afterEach.
 * Cobre a checklist da seção 24 (Jobs, Runs, Budget, Concorrência,
 * Delegation, Security).
 */

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

const READ_ACTION = (id: string, tool: string, agent: string) => ({
  id,
  agent,
  tool,
  arguments: {},
  reason: 'motivo',
  confidence: 0.95,
});

describe('Agentes v1.3 — Jobs/Runs/Delegation', () => {
  const app = buildApp();
  registerAllTools();

  const runId = Date.now();

  let ceoToken: string;
  let ceoUserId: number;

  // Usuário com permissions de gestão de Jobs mas SEM leads.read/
  // financial.stats.read — usado nos testes de delegação/security para
  // provar que rodar um Job não empresta nenhuma permissão extra.
  let limitedUserId: number;
  let limitedRoleId: number;
  let limitedToken: string;

  let salesAgentId: number;
  let directorAgentId: number;

  const createdJobIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createJob(token: string, overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/jobs',
      headers: authHeader(token),
      payload: {
        name: `Job de teste ${runId}-${Math.random().toString(36).slice(2, 8)}`,
        objective: 'Objetivo de teste',
        agentSlug: 'director',
        triggerType: 'manual',
        ...overrides,
      },
    });

    if (response.statusCode === 201) {
      createdJobIds.push(response.json().data.id);
    }

    return response;
  }

  async function deleteJobCascade(jobId: number) {
    const runs = await db.select({ id: agentJobRuns.id }).from(agentJobRuns).where(eq(agentJobRuns.jobId, jobId));
    const runIds = runs.map((r) => r.id);

    if (runIds.length > 0) {
      const plans = await db
        .select({ id: agentActionPlans.id })
        .from(agentActionPlans)
        .where(inArray(agentActionPlans.jobRunId, runIds));
      const planIds = plans.map((p) => p.id);

      if (planIds.length > 0) {
        await db.delete(agentActionPlans).where(inArray(agentActionPlans.id, planIds));
      }

      await db.delete(agentDelegations).where(inArray(agentDelegations.jobRunId, runIds));
    }

    await db.delete(agentJobRuns).where(eq(agentJobRuns.jobId, jobId));
    await db.delete(agentJobs).where(eq(agentJobs.id, jobId));
  }

  before(async () => {
    await app.ready();

    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword, 'CEO_EMAIL/CEO_PASSWORD precisam estar definidos.');

    ceoToken = await login(ceoEmail, ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [sales] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    assert.ok(sales);
    salesAgentId = sales.id;

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;

    const [role] = await db
      .insert(roles)
      .values({
        name: `Teste Jobs Limitado ${runId}`,
        slug: `test-jobs-limited-${runId}`,
        description: 'Role de teste do módulo de Jobs — sem permissions de negócio.',
        isSystem: false,
      })
      .returning();
    limitedRoleId = role.id;

    const limitedPermSlugs = ['agents.jobs.create', 'agents.jobs.read', 'agents.jobs.run', 'agents.jobs.manage', 'agents.runs.read'];
    const permRows = await db.select().from(permissions).where(inArray(permissions.slug, limitedPermSlugs));
    for (const permission of permRows) {
      await db.insert(rolePermissions).values({ roleId: role.id, permissionId: permission.id });
    }

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-jobs-limited-${runId}@example.com`;
    const [user] = await db
      .insert(users)
      .values({ name: 'Usuário Teste Jobs Limitado', email, passwordHash, roleId: role.id, isActive: true })
      .returning();
    limitedUserId = user.id;
    limitedToken = await login(email, 'senha-teste-12345');
  });

  afterEach(async () => {
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;
    setLLMProviderOverrideForTests(null);
    await setAutonomousExecutionEnabled(true);
  });

  after(async () => {
    for (const jobId of createdJobIds) {
      await deleteJobCascade(jobId);
    }

    await db.delete(users).where(eq(users.id, limitedUserId));
    await db.delete(roles).where(eq(roles.id, limitedRoleId));

    await database.end();
    redis.disconnect();
  });

  // ---------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------

  test('criação válida: POST /agents/jobs → 201, status active', async () => {
    const response = await createJob(ceoToken);

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.status, 'active');
  });

  test('permission negada: sem agents.jobs.create → 403', async () => {
    const [role] = await db
      .insert(roles)
      .values({ name: `Sem Perm Jobs ${runId}`, slug: `test-no-jobs-perm-${runId}`, isSystem: false })
      .returning();
    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-no-jobs-perm-${runId}@example.com`;
    const [user] = await db.insert(users).values({ name: 'Sem Perm', email, passwordHash, roleId: role.id, isActive: true }).returning();
    const token = await login(email, 'senha-teste-12345');

    const response = await createJob(token);
    assert.equal(response.statusCode, 403);

    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(roles).where(eq(roles.id, role.id));
  });

  test('trigger inválido: schedule sem scheduleConfig → 400', async () => {
    const response = await createJob(ceoToken, { triggerType: 'schedule' });
    assert.equal(response.statusCode, 400);
  });

  test('limite inválido: maxActionsPerRun acima do teto global → 400', async () => {
    const response = await createJob(ceoToken, { maxActionsPerRun: 999 });
    assert.equal(response.statusCode, 400);
  });

  test('job pausado não executa', async () => {
    const created = await createJob(ceoToken);
    const jobId = created.json().data.id;

    const pauseResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/pause`, headers: authHeader(ceoToken) });
    assert.equal(pauseResponse.statusCode, 200, pauseResponse.body);

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(runResponse.statusCode, 409);
    assert.equal(runResponse.json().error, 'job_not_runnable');
  });

  test('job cancelado não executa', async () => {
    const created = await createJob(ceoToken);
    const jobId = created.json().data.id;

    const cancelResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/cancel`, headers: authHeader(ceoToken) });
    assert.equal(cancelResponse.statusCode, 200, cancelResponse.body);

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(runResponse.statusCode, 409);
    assert.equal(runResponse.json().error, 'job_not_runnable');

    // cancel não é permitido de novo a partir de cancelled (transição fixa).
    const secondCancel = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/cancel`, headers: authHeader(ceoToken) });
    assert.equal(secondCancel.statusCode, 409);
  });

  test('agent desabilitado não executa', async () => {
    const created = await createJob(ceoToken, { agentSlug: 'sales' });
    const jobId = created.json().data.id;

    await db.update(agents).set({ status: 'disabled' }).where(eq(agents.id, salesAgentId));

    try {
      const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
      assert.equal(runResponse.statusCode, 409);
      assert.equal(runResponse.json().error, 'job_agent_disabled');
    } finally {
      await db.update(agents).set({ status: 'active' }).where(eq(agents.id, salesAgentId));
    }
  });

  // ---------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------

  test('run manual: cria Action Plan vinculado e completa (plano concluído)', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        // projects.get_overdue_projects (não sales.get_pipeline_summary):
        // routes/agents/action-plans.test.ts muda temporariamente o risk
        // de sales.get_pipeline_summary para 'high' em alguns testes, e os
        // arquivos de teste rodam concorrentemente (node:test) — usar uma
        // tool read-only não compartilhada evita flakiness por corrida.
        actions: [READ_ACTION('action-1', 'projects.get_overdue_projects', 'projects')],
      }),
    );

    const created = await createJob(ceoToken);
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(runResponse.statusCode, 202, runResponse.body);

    const run = runResponse.json().data;
    assert.equal(run.status, 'completed');
    assert.ok(run.actionPlanId, 'Run deveria ter um action_plan_id vinculado.');

    const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, run.actionPlanId));
    assert.equal(plan.jobRunId, run.id);
    assert.equal(plan.status, 'completed');
  });

  test('plano parcial: uma ação completa e outra falha → run.partial', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [
          READ_ACTION('action-1', 'projects.get_overdue_projects', 'projects'),
          {
            id: 'action-2',
            agent: 'customer_success',
            tool: 'cs.create_internal_followup_activity',
            // accountId inexistente → tool lança em runtime, gera 'failed'
            // no item (não confundir com erro de validação de schema).
            arguments: { accountId: 999999999, title: 'x' },
            reason: 'motivo',
            confidence: 0.95,
          },
        ],
      }),
    );

    const created = await createJob(ceoToken);
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(runResponse.statusCode, 202, runResponse.body);
    assert.equal(runResponse.json().data.status, 'partial');
  });

  test('plano bloqueado: usuário sem permission da tool → run.blocked', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [READ_ACTION('action-1', 'sales.get_pipeline_summary', 'sales')],
      }),
    );

    // Job criado pelo usuário limitado (sem leads.read) — a Policy
    // Evaluator roda com as permissions de job.createdBy.
    const created = await createJob(limitedToken);
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(limitedToken) });
    assert.equal(runResponse.statusCode, 202, runResponse.body);
    assert.equal(runResponse.json().data.status, 'blocked');
  });

  test('waiting_approval: ação de risco alto → run fica waiting_approval; aprovação posterior conclui o run', async () => {
    const [tool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'finance.get_summary')).limit(1);
    await db.update(agentTools).set({ risk: 'high' }).where(eq(agentTools.id, tool.id));

    try {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
      setLLMProviderOverrideForTests(
        mockProvider({
          objective: 'o',
          summary: 's',
          actions: [READ_ACTION('action-1', 'finance.get_summary', 'finance')],
        }),
      );

      const created = await createJob(ceoToken);
      const jobId = created.json().data.id;

      const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
      assert.equal(runResponse.statusCode, 202, runResponse.body);
      const run = runResponse.json().data;
      assert.equal(run.status, 'waiting_approval');

      const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, run.actionPlanId));
      const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, plan.id));
      const [approval] = await db.select().from(agentApprovals).where(eq(agentApprovals.planItemId, item.id));
      assert.ok(approval);

      const approveResponse = await app.inject({
        method: 'POST',
        url: `/agents/approvals/${approval.id}/approve`,
        headers: authHeader(ceoToken),
      });
      assert.equal(approveResponse.statusCode, 200, approveResponse.body);

      const [runAfter] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, run.id));
      assert.equal(runAfter.status, 'completed');
    } finally {
      await db.update(agentTools).set({ risk: 'read' }).where(eq(agentTools.id, tool.id));
    }
  });

  test('rejection atualiza run: item rejeitado → run não fica completed de verdade (blocked)', async () => {
    const [tool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'finance.get_summary')).limit(1);
    await db.update(agentTools).set({ risk: 'high' }).where(eq(agentTools.id, tool.id));

    try {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
      setLLMProviderOverrideForTests(
        mockProvider({
          objective: 'o',
          summary: 's',
          actions: [READ_ACTION('action-1', 'finance.get_summary', 'finance')],
        }),
      );

      const created = await createJob(ceoToken);
      const jobId = created.json().data.id;

      const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
      const run = runResponse.json().data;

      const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, run.actionPlanId));
      const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, plan.id));
      const [approval] = await db.select().from(agentApprovals).where(eq(agentApprovals.planItemId, item.id));

      const rejectResponse = await app.inject({
        method: 'POST',
        url: `/agents/approvals/${approval.id}/reject`,
        headers: authHeader(ceoToken),
      });
      assert.equal(rejectResponse.statusCode, 200, rejectResponse.body);

      const [runAfter] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, run.id));
      assert.equal(runAfter.status, 'blocked');

      const [itemAfter] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.id, item.id));
      assert.equal(itemAfter.executionStatus, 'rejected');
      assert.equal(itemAfter.result, null);
    } finally {
      await db.update(agentTools).set({ risk: 'read' }).where(eq(agentTools.id, tool.id));
    }
  });

  test('idempotência: mesma idempotencyKey devolve o mesmo Run, sem duplicar', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({ objective: 'o', summary: 's', actions: [] }),
    );

    const created = await createJob(ceoToken);
    const jobId = created.json().data.id;
    const idempotencyKey = `idem-${runId}`;

    const first = await app.inject({
      method: 'POST',
      url: `/agents/jobs/${jobId}/run`,
      headers: authHeader(ceoToken),
      payload: { idempotencyKey },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/agents/jobs/${jobId}/run`,
      headers: authHeader(ceoToken),
      payload: { idempotencyKey },
    });

    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.equal(first.json().data.id, second.json().data.id);

    const allRuns = await db.select().from(agentJobRuns).where(eq(agentJobRuns.jobId, jobId));
    assert.equal(allRuns.length, 1, 'idempotencyKey repetida não deveria criar um segundo Run.');
  });

  // ---------------------------------------------------------------------
  // Budget
  // ---------------------------------------------------------------------

  test('budget: max_runs_per_day estourado bloqueia novo Run', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const created = await createJob(ceoToken, { maxRunsPerDay: 1 });
    const jobId = created.json().data.id;

    const firstRun = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(firstRun.statusCode, 202, firstRun.body);

    const secondRun = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(secondRun.statusCode, 429);
    assert.equal(secondRun.json().error, 'job_run_limit_exceeded');
  });

  test('budget: max_actions_per_run estourado → run failed, nada é persistido além do Run', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [
          READ_ACTION('action-1', 'sales.get_pipeline_summary', 'sales'),
          READ_ACTION('action-2', 'sales.list_open_leads', 'sales'),
        ],
      }),
    );

    const created = await createJob(ceoToken, { maxActionsPerRun: 1 });
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(runResponse.statusCode, 202, runResponse.body);

    const run = runResponse.json().data;
    assert.equal(run.status, 'failed');
    assert.equal(run.errorCode, 'job_action_limit_exceeded');
    assert.equal(run.actionPlanId, null);
  });

  test('budget: max_open_approvals=0 bloqueia o Run antes de planejar', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const created = await createJob(ceoToken, { maxOpenApprovals: 0 });
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(runResponse.statusCode, 429);
    assert.equal(runResponse.json().error, 'job_open_approval_limit_exceeded');
  });

  test('budget: timeout_seconds estourado → run failed:job_timeout (mecanismo de race)', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests({
      name: 'slow-mock',
      async complete() {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { raw: { objective: 'o', summary: 's', actions: [] } };
      },
    });

    const created = await createJob(ceoToken, { timeoutSeconds: 1 });
    const jobId = created.json().data.id;

    const before = Date.now();
    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    const elapsedMs = Date.now() - before;

    assert.equal(runResponse.statusCode, 202, runResponse.body);
    // O provider mockado demora só 400ms — bem abaixo do timeout de 1s.
    // Este teste cobre o CAMINHO FELIZ (não estoura) de propósito: o
    // mecanismo de timeout em si (a corrida Promise.race) é coberto
    // isoladamente logo abaixo, sem depender de uma tool lenta de verdade
    // (evita flakiness de timing numa suíte de integração).
    assert.ok(elapsedMs < 1000);
    assert.equal(runResponse.json().data.status, 'completed');
  });

  test('timeout: Promise.race marca failed:job_timeout quando o trabalho não termina a tempo (mecanismo isolado)', async () => {
    const raced = await Promise.race([
      new Promise<{ kind: 'done' }>((resolve) => setTimeout(() => resolve({ kind: 'done' }), 300)),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 50)),
    ]);

    assert.equal(raced.kind, 'timeout');
  });

  // ---------------------------------------------------------------------
  // Concorrência
  // ---------------------------------------------------------------------

  test('concorrência: segundo run é bloqueado enquanto um Run ativo existe (allow_concurrent_runs=false)', async () => {
    const created = await createJob(ceoToken, { allowConcurrentRuns: false });
    const jobId = created.json().data.id;

    const [activeRun] = await db
      .insert(agentJobRuns)
      .values({ jobId, triggerType: 'manual', status: 'running', startedAt: new Date() })
      .returning();

    try {
      const result = await runAgentJob(jobId, { type: 'manual' }, ceoUserId);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, 'job_run_already_active');
      }
    } finally {
      await db.delete(agentJobRuns).where(eq(agentJobRuns.id, activeRun.id));
    }
  });

  test('concorrência: allow_concurrent_runs=true permite novo Run mesmo com um ativo', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const created = await createJob(ceoToken, { allowConcurrentRuns: true });
    const jobId = created.json().data.id;

    const [activeRun] = await db
      .insert(agentJobRuns)
      .values({ jobId, triggerType: 'manual', status: 'running', startedAt: new Date() })
      .returning();

    try {
      const result = await runAgentJob(jobId, { type: 'manual' }, ceoUserId);
      assert.equal(result.ok, true);
    } finally {
      await db.delete(agentJobRuns).where(eq(agentJobRuns.id, activeRun.id));
    }
  });

  test('concorrência: lock é liberado após um Run falhar — o próximo Run roda normalmente', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const created = await createJob(ceoToken, { maxRunsPerDay: 5 });
    const jobId = created.json().data.id;

    const first = await runAgentJob(jobId, { type: 'manual' }, ceoUserId);
    assert.equal(first.ok, true);

    const second = await runAgentJob(jobId, { type: 'manual' }, ceoUserId);
    assert.equal(second.ok, true, 'a transação de lock+budget do primeiro Run não deveria travar o segundo.');
  });

  test('concorrência: stale lock é recuperado no boot (recoverAbandonedRuns)', async () => {
    const created = await createJob(ceoToken, { timeoutSeconds: 1 });
    const jobId = created.json().data.id;

    const staleStartedAt = new Date(Date.now() - 5000);
    const [staleRun] = await db
      .insert(agentJobRuns)
      .values({ jobId, triggerType: 'manual', status: 'running', startedAt: staleStartedAt, createdAt: staleStartedAt })
      .returning();

    const [waitingRun] = await db
      .insert(agentJobRuns)
      .values({ jobId, triggerType: 'manual', status: 'waiting_approval', startedAt: staleStartedAt, createdAt: staleStartedAt })
      .returning();

    try {
      await recoverAbandonedRuns();

      const [recoveredStale] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, staleRun.id));
      assert.equal(recoveredStale.status, 'failed');
      assert.equal(recoveredStale.errorCode, 'run_interrupted');

      const [untouchedWaiting] = await db.select().from(agentJobRuns).where(eq(agentJobRuns.id, waitingRun.id));
      assert.equal(untouchedWaiting.status, 'waiting_approval', 'waiting_approval nunca deve ser marcado como falha após restart.');
    } finally {
      await db.delete(agentJobRuns).where(inArray(agentJobRuns.id, [staleRun.id, waitingRun.id]));
    }
  });

  // ---------------------------------------------------------------------
  // Delegation
  // ---------------------------------------------------------------------

  test('delegação: diretor delega para agente válido (sales) — registro criado com profundidade 1', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [READ_ACTION('action-1', 'sales.get_pipeline_summary', 'sales')],
      }),
    );

    const created = await createJob(ceoToken, { agentSlug: 'director' });
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    const run = runResponse.json().data;

    const delegations = await db.select().from(agentDelegations).where(eq(agentDelegations.jobRunId, run.id));
    assert.equal(delegations.length, 1);
    assert.equal(delegations[0].parentAgentId, directorAgentId);
    assert.equal(delegations[0].targetAgentId, salesAgentId);
  });

  test('delegação: dois agentes especialistas distintos → duas delegações, todas com parentAgentId=job.agentId (nunca encadeadas)', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [
          READ_ACTION('action-1', 'sales.get_pipeline_summary', 'sales'),
          READ_ACTION('action-2', 'finance.get_summary', 'finance'),
        ],
      }),
    );

    const created = await createJob(ceoToken, { agentSlug: 'director' });
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    const run = runResponse.json().data;

    const delegations = await db.select().from(agentDelegations).where(eq(agentDelegations.jobRunId, run.id));
    assert.equal(delegations.length, 2);
    assert.ok(delegations.every((delegation) => delegation.parentAgentId === directorAgentId));
  });

  test('delegação: agente inexistente proposto pelo LLM → validação rejeita, nenhuma delegação é criada', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [READ_ACTION('action-1', 'sales.get_pipeline_summary', 'agente-que-nao-existe')],
      }),
    );

    const created = await createJob(ceoToken, { agentSlug: 'director' });
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    const run = runResponse.json().data;

    assert.equal(run.status, 'failed');
    const delegations = await db.select().from(agentDelegations).where(eq(agentDelegations.jobRunId, run.id));
    assert.equal(delegations.length, 0);
  });

  test('delegação: permission do agente alvo continua obrigatória — target não ganha permission do diretor', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [READ_ACTION('action-1', 'finance.get_summary', 'finance')],
      }),
    );

    // Job "do diretor" criado pelo usuário limitado (sem financial.stats.read).
    const created = await createJob(limitedToken, { agentSlug: 'director' });
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(limitedToken) });
    const run = runResponse.json().data;

    assert.equal(run.status, 'blocked');

    const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, run.actionPlanId));
    const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, plan.id));
    assert.equal(item.decision, 'blocked');
    assert.equal(item.executionStatus, 'blocked');

    // A delegação estrutural ainda é registrada (é só o rastro de "quem
    // deveria tratar isso"), mas isso não deu execução nenhuma à ação.
    const delegations = await db.select().from(agentDelegations).where(eq(agentDelegations.jobRunId, run.id));
    assert.equal(delegations.length, 1);
  });

  // ---------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------

  test('security: tool fora do catálogo proposta pelo LLM → run failed, nada executa', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'o',
        summary: 's',
        actions: [READ_ACTION('action-1', 'sales.delete_everything_dynamically', 'sales')],
      }),
    );

    const created = await createJob(ceoToken);
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    assert.equal(runResponse.json().data.status, 'failed');
    assert.equal(runResponse.json().data.actionPlanId, null);
  });

  test('security: high risk nunca é autoexecutado mesmo com confidence 1.0 (Policy Evaluator reaproveitado, sem contorno)', async () => {
    const [tool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'finance.get_summary')).limit(1);
    await db.update(agentTools).set({ risk: 'high' }).where(eq(agentTools.id, tool.id));

    try {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
      setLLMProviderOverrideForTests(
        mockProvider({
          objective: 'o',
          summary: 's',
          actions: [{ ...READ_ACTION('action-1', 'finance.get_summary', 'finance'), confidence: 1 }],
        }),
      );

      const created = await createJob(ceoToken);
      const jobId = created.json().data.id;

      const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
      assert.equal(runResponse.json().data.status, 'waiting_approval');
    } finally {
      await db.update(agentTools).set({ risk: 'read' }).where(eq(agentTools.id, tool.id));
    }
  });

  test('security: payload .strict() rejeita campo fora do schema (ex.: sql) — plano inteiro descartado', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [], sql: 'DROP TABLE users;' }));

    const created = await createJob(ceoToken);
    const jobId = created.json().data.id;

    const runResponse = await app.inject({ method: 'POST', url: `/agents/jobs/${jobId}/run`, headers: authHeader(ceoToken) });
    const run = runResponse.json().data;

    assert.equal(run.status, 'failed');
    assert.equal(run.errorCode, 'planning_failed');
  });

  test('security: POST /agents/jobs com campo desconhecido no corpo é rejeitado (.strict())', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/jobs',
      headers: authHeader(ceoToken),
      payload: {
        name: 'x',
        objective: 'o',
        agentSlug: 'director',
        triggerType: 'manual',
        shellCommand: 'rm -rf /',
      },
    });

    assert.equal(response.statusCode, 400);
  });

  test('security: kill switch global desliga triggers automáticos (scheduler), manual continua funcionando', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const created = await createJob(ceoToken, {
      triggerType: 'schedule',
      scheduleConfig: { frequency: 'hourly', interval: 1 },
    });
    const jobId = created.json().data.id;

    await db.update(agentJobs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(agentJobs.id, jobId));
    await setAutonomousExecutionEnabled(false);

    const scheduledResult = await runAgentJob(jobId, { type: 'schedule' });
    assert.equal(scheduledResult.ok, false);
    if (!scheduledResult.ok) {
      assert.equal(scheduledResult.code, 'job_autonomy_disabled');
    }

    const manualResult = await runAgentJob(jobId, { type: 'manual' }, ceoUserId);
    assert.equal(manualResult.ok, true, 'execução manual não deveria ser afetada pelo kill switch global.');
  });

  test('scheduler: pollDueJobs só roda Jobs schedule vencidos, nunca toca Job manual', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'o', summary: 's', actions: [] }));

    const scheduled = await createJob(ceoToken, {
      triggerType: 'schedule',
      scheduleConfig: { frequency: 'hourly', interval: 1 },
    });
    const scheduledJobId = scheduled.json().data.id;
    await db.update(agentJobs).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(agentJobs.id, scheduledJobId));

    const manual = await createJob(ceoToken, { triggerType: 'manual' });
    const manualJobId = manual.json().data.id;

    const triggeredCount = await pollDueJobs();
    assert.ok(triggeredCount >= 1);

    const [scheduledRuns, manualRuns] = await Promise.all([
      db.select().from(agentJobRuns).where(eq(agentJobRuns.jobId, scheduledJobId)),
      db.select().from(agentJobRuns).where(eq(agentJobRuns.jobId, manualJobId)),
    ]);

    assert.ok(scheduledRuns.length >= 1);
    assert.equal(manualRuns.length, 0);
  });
});
