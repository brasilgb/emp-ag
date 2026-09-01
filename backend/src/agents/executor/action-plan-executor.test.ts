import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentActionPlanItems, agentActionPlans, agentTools, agents, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { registerTool } from '../tool-registry.js';
import { executeActionPlan } from './action-plan-executor.js';

/*
 * Testes de integração do Action Plan Executor (correio.md v1.2 seção 7,
 * casos da seção 15: blocked não executa, shadow não muta, execução
 * parcial, falha de dependência, idempotência, nunca executa
 * waiting_approval). Insere plano+itens diretamente no banco (sem passar
 * pelo planner/rota) para isolar só o executor.
 */

let runCount = 0;

registerTool({
  handler: 'test.executor_echo',
  requiredPermission: 'agents.use',
  inputSchema: z.object({ shouldFail: z.boolean().optional() }).strict(),
  async run(input: { shouldFail?: boolean }) {
    runCount += 1;

    if (input.shouldFail) {
      const error = new Error('Falha proposital de teste.') as Error & { code: string };
      error.code = 'execution_failed';
      throw error;
    }

    return { success: true, summary: 'ok', data: { runCount } };
  },
});

describe('Action Plan Executor', () => {
  let ceoUserId: number;
  let salesAgentId: number;
  let toolId: number;

  const createdPlanIds: number[] = [];

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    assert.ok(ceoEmail, 'CEO_EMAIL precisa estar definido.');

    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser, 'Usuário CEO do seed não encontrado.');
    ceoUserId = ceoUser.id;

    const [sales] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    assert.ok(sales, 'Agente sales do seed não encontrado.');
    salesAgentId = sales.id;

    const [tool] = await db
      .insert(agentTools)
      .values({
        name: 'Test Executor Echo',
        slug: `test-executor-echo-${Date.now()}`,
        description: 'Tool de teste do executor de Action Plan.',
        department: 'sales',
        autonomyLevel: 'execute',
        handler: 'test.executor_echo',
        isActive: true,
        isSensitive: false,
        risk: 'low',
        mutatesData: true,
        requiresApproval: false,
      })
      .returning();

    toolId = tool.id;
  });

  after(async () => {
    for (const planId of createdPlanIds) {
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, planId));
    }

    await db.delete(agentTools).where(eq(agentTools.id, toolId));
    await database.end();
    redis.disconnect();
  });

  async function createPlan(
    items: Array<{
      actionId: string;
      decision: 'execute' | 'approval_required' | 'blocked' | 'shadow';
      dependencies?: string[];
      arguments?: Record<string, unknown>;
    }>,
  ) {
    const [plan] = await db
      .insert(agentActionPlans)
      .values({ requestedBy: ceoUserId, objective: 'Teste executor', summary: 'Teste executor', status: 'evaluating' })
      .returning();

    createdPlanIds.push(plan.id);

    let sequence = 0;

    for (const item of items) {
      const executionStatus =
        item.decision === 'execute'
          ? 'pending'
          : item.decision === 'approval_required'
            ? 'waiting_approval'
            : item.decision === 'blocked'
              ? 'blocked'
              : 'skipped';

      await db.insert(agentActionPlanItems).values({
        planId: plan.id,
        sequence: sequence++,
        actionId: item.actionId,
        agent: 'sales',
        agentId: salesAgentId,
        tool: 'test.executor_echo',
        toolId,
        arguments: item.arguments ?? {},
        dependencies: item.dependencies ?? [],
        reason: 'teste',
        confidence: '0.900',
        risk: 'low',
        decision: item.decision,
        executionStatus,
      });
    }

    return plan.id;
  }

  async function itemsOf(planId: number) {
    return db
      .select()
      .from(agentActionPlanItems)
      .where(eq(agentActionPlanItems.planId, planId))
      .orderBy(agentActionPlanItems.sequence);
  }

  test('item com decision=blocked nunca executa', async () => {
    const planId = await createPlan([{ actionId: 'a1', decision: 'blocked' }]);

    const before = runCount;
    const result = await executeActionPlan(planId, ceoUserId);

    assert.equal(runCount, before, 'tool nunca deveria ter rodado para um item blocked.');

    const items = await itemsOf(planId);
    assert.equal(items[0].executionStatus, 'blocked');
    assert.equal(result.status, 'completed');
  });

  test('item com decision=approval_required (waiting_approval) nunca executa sem aprovação', async () => {
    const planId = await createPlan([{ actionId: 'a1', decision: 'approval_required' }]);

    const before = runCount;
    await executeActionPlan(planId, ceoUserId);

    assert.equal(runCount, before, 'tool nunca deveria rodar antes da aprovação.');

    const items = await itemsOf(planId);
    assert.equal(items[0].executionStatus, 'waiting_approval');
  });

  test('item com decision=shadow (skipped) nunca muta dados', async () => {
    const planId = await createPlan([{ actionId: 'a1', decision: 'shadow' }]);

    const before = runCount;
    await executeActionPlan(planId, ceoUserId);

    assert.equal(runCount, before, 'shadow nunca deveria executar de fato.');

    const items = await itemsOf(planId);
    assert.equal(items[0].executionStatus, 'skipped');
  });

  test('falha de dependência: item dependente nunca roda e fica failed', async () => {
    const planId = await createPlan([
      { actionId: 'a1', decision: 'execute', arguments: { shouldFail: true } },
      { actionId: 'a2', decision: 'execute', dependencies: ['a1'] },
    ]);

    const before = runCount;
    const result = await executeActionPlan(planId, ceoUserId);

    // Só a1 chega a rodar (e falha); a2 nunca roda por causa da
    // dependência falha.
    assert.equal(runCount, before + 1);

    const items = await itemsOf(planId);
    const a1 = items.find((item) => item.actionId === 'a1')!;
    const a2 = items.find((item) => item.actionId === 'a2')!;

    assert.equal(a1.executionStatus, 'failed');
    assert.equal(a2.executionStatus, 'failed');
    assert.deepEqual(a2.error, { code: 'dependency_failed', message: 'Uma ou mais dependências não foram concluídas.' });
    assert.equal(result.status, 'failed');
  });

  test('execução parcial: uma ação completa e outra falha (sem dependência entre elas) → plano partial', async () => {
    const planId = await createPlan([
      { actionId: 'a1', decision: 'execute' },
      { actionId: 'a2', decision: 'execute', arguments: { shouldFail: true } },
    ]);

    const result = await executeActionPlan(planId, ceoUserId);

    const items = await itemsOf(planId);
    assert.equal(items.find((item) => item.actionId === 'a1')!.executionStatus, 'completed');
    assert.equal(items.find((item) => item.actionId === 'a2')!.executionStatus, 'failed');
    assert.equal(result.status, 'partial');
  });

  test('idempotência: reexecutar um plano já completo não roda a tool de novo', async () => {
    const planId = await createPlan([{ actionId: 'a1', decision: 'execute' }]);

    await executeActionPlan(planId, ceoUserId);
    const afterFirst = runCount;

    await executeActionPlan(planId, ceoUserId);
    assert.equal(runCount, afterFirst, 'reexecutar não deveria rodar a tool de novo para um item já completed.');

    const result = await executeActionPlan(planId, ceoUserId);
    assert.equal(runCount, afterFirst);
    assert.equal(result.status, 'completed');
  });

  test('dependências resolvidas: item completo com sucesso depende de outro que já concluiu', async () => {
    const planId = await createPlan([
      { actionId: 'a1', decision: 'execute' },
      { actionId: 'a2', decision: 'execute', dependencies: ['a1'] },
    ]);

    const result = await executeActionPlan(planId, ceoUserId);

    const items = await itemsOf(planId);
    assert.equal(items.find((item) => item.actionId === 'a1')!.executionStatus, 'completed');
    assert.equal(items.find((item) => item.actionId === 'a2')!.executionStatus, 'completed');
    assert.equal(result.status, 'completed');
  });
});
