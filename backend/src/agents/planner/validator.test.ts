import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentTools, agents } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { registerTool } from '../tool-registry.js';
import { registerAllTools } from '../tools/index.js';
import { MAX_ACTIONS_PER_PLAN } from './schemas.js';
import { validateActionPlan } from './validator.js';
import type { ActionPlanPayload } from './schemas.js';

/*
 * Testes de integração do Action Plan validator (correio.md v1.2 seção 3,
 * casos da seção 15: plano válido, tool inexistente, argumentos inválidos,
 * dependência inexistente, dependência circular, tool não registrada,
 * excesso de ações). Mesmo padrão de llm/interpreter.test.ts: banco real,
 * seed já rodado, tool de teste registrada só neste arquivo.
 */

const testToolInputSchema = z.object({ note: z.string().trim().min(1) }).strict();

registerTool({
  handler: 'test.planner_echo',
  requiredPermission: 'agents.use',
  inputSchema: testToolInputSchema,
  async run(input) {
    return { success: true, summary: 'ok', data: input };
  },
});

// Registrada em código, de propósito nunca inserida em agent_tools — só
// para exercitar a barreira "existe no registry MAS não está ativa no
// banco" isoladamente da barreira "nem existe no registry".
registerTool({
  handler: 'test.planner_not_in_db',
  requiredPermission: 'agents.use',
  inputSchema: z.object({}).strict(),
  async run() {
    return { success: true, summary: 'ok', data: {} };
  },
});

function plan(actions: ActionPlanPayload['actions']): ActionPlanPayload {
  return { objective: 'Objetivo de teste', summary: 'Resumo de teste', actions };
}

describe('Action Plan validator', () => {
  registerAllTools();

  let testToolId: number;

  before(async () => {
    const [sales] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    assert.ok(sales, 'Agente sales do seed não encontrado (rode npm run db:seed).');

    const [row] = await db
      .insert(agentTools)
      .values({
        name: 'Test Planner Echo',
        slug: `test-planner-echo-${Date.now()}`,
        description: 'Tool de teste do validator de Action Plan.',
        department: 'sales',
        autonomyLevel: 'execute',
        handler: 'test.planner_echo',
        isActive: true,
        isSensitive: false,
        risk: 'low',
        mutatesData: false,
        requiresApproval: false,
      })
      .returning();

    testToolId = row.id;
  });

  after(async () => {
    if (testToolId) {
      await db.delete(agentTools).where(eq(agentTools.id, testToolId));
    }

    await database.end();
    redis.disconnect();
  });

  test('plano válido com dependências passa e devolve toolId/agentId resolvidos', async () => {
    const result = await validateActionPlan(
      plan([
        { id: 'action-1', agent: 'sales', tool: 'test.planner_echo', arguments: { note: 'a' }, reason: 'r', confidence: 0.9 },
        {
          id: 'action-2',
          agent: 'sales',
          tool: 'test.planner_echo',
          arguments: { note: 'b' },
          reason: 'r',
          confidence: 0.9,
          dependencies: ['action-1'],
        },
      ]),
    );

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.actions.length, 2);
      assert.equal(result.actions[0].toolId, testToolId);
    }
  });

  test('tool inexistente no registry → tool_not_found', async () => {
    const result = await validateActionPlan(
      plan([{ id: 'action-1', agent: 'sales', tool: 'nope.does_not_exist', arguments: {}, reason: 'r', confidence: 0.9 }]),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0].code, 'tool_not_found');
    }
  });

  test('tool registrada em código mas não ativa no banco → tool_not_found', async () => {
    const result = await validateActionPlan(
      plan([
        {
          id: 'action-1',
          agent: 'sales',
          tool: 'test.planner_not_in_db',
          arguments: {},
          reason: 'r',
          confidence: 0.9,
        },
      ]),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0].code, 'tool_not_found');
    }
  });

  test('argumentos inválidos (schema real da tool) → invalid_arguments', async () => {
    const result = await validateActionPlan(
      plan([{ id: 'action-1', agent: 'sales', tool: 'test.planner_echo', arguments: {}, reason: 'r', confidence: 0.9 }]),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.errors[0].code, 'invalid_arguments');
    }
  });

  test('dependência inexistente → unknown_dependency', async () => {
    const result = await validateActionPlan(
      plan([
        {
          id: 'action-1',
          agent: 'sales',
          tool: 'test.planner_echo',
          arguments: { note: 'a' },
          reason: 'r',
          confidence: 0.9,
          dependencies: ['nao-existe'],
        },
      ]),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((error) => error.code === 'unknown_dependency'));
    }
  });

  test('dependência circular → circular_dependency', async () => {
    const result = await validateActionPlan(
      plan([
        {
          id: 'action-1',
          agent: 'sales',
          tool: 'test.planner_echo',
          arguments: { note: 'a' },
          reason: 'r',
          confidence: 0.9,
          dependencies: ['action-2'],
        },
        {
          id: 'action-2',
          agent: 'sales',
          tool: 'test.planner_echo',
          arguments: { note: 'b' },
          reason: 'r',
          confidence: 0.9,
          dependencies: ['action-1'],
        },
      ]),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((error) => error.code === 'circular_dependency'));
    }
  });

  test(`mais de ${MAX_ACTIONS_PER_PLAN} ações → too_many_actions`, async () => {
    const actions = Array.from({ length: MAX_ACTIONS_PER_PLAN + 1 }, (_, index) => ({
      id: `action-${index}`,
      agent: 'sales',
      tool: 'test.planner_echo',
      arguments: { note: 'a' },
      reason: 'r',
      confidence: 0.9,
    }));

    // Bypassa o .max(10) do Zod (que já bloquearia isso antes de chegar
    // aqui em produção) para exercitar a segunda barreira do validator
    // isoladamente.
    const result = await validateActionPlan({ objective: 'o', summary: 's', actions } as ActionPlanPayload);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.errors.some((error) => error.code === 'too_many_actions'));
    }
  });
});
