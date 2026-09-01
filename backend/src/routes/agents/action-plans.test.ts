import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
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
import type { LLMProvider, LLMResponse } from '../../agents/llm/types.js';

/*
 * Testes de integração de Action Planning (correio.md v1.2 — POST/GET
 * /agents/action-plans, POST /agents/approvals/:id/approve|reject sobre
 * item de plano). Mesmo padrão de routes/agents/llm.test.ts: banco real,
 * provider LLM mockado via setLLMProviderOverrideForTests, envs limpas em
 * afterEach.
 */

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

describe('Agentes v1.2 — Action Planning', () => {
  const app = buildApp();
  registerAllTools();

  const runId = Date.now();

  let ceoToken: string;
  let ceoUserId: number;
  let noPlanPermToken: string;
  let noPlanPermRoleId: number;
  let noPlanPermUserId: number;

  let highRiskToolId: number;

  const createdPlanIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createPlan(token: string, objective = 'Objetivo de teste') {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/action-plans',
      headers: authHeader(token),
      payload: { objective },
    });

    if (response.statusCode === 201) {
      const planId = response.json().data.plan.id as number;
      createdPlanIds.push(planId);
    }

    return response;
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

    await redis.del(`agents:ratelimit:plan:${ceoUserId}`);

    // Usuário só com agents.use — sem agents.plan (para o teste de
    // permission).
    const [role] = await db
      .insert(roles)
      .values({
        name: `Teste Plans Sem Permission ${runId}`,
        slug: `test-plans-no-perm-${runId}`,
        description: 'Role de teste do módulo de Action Plans.',
        isSystem: false,
      })
      .returning();
    noPlanPermRoleId = role.id;

    const [agentsUsePermission] = await db
      .select()
      .from(permissions)
      .where(eq(permissions.slug, 'agents.use'))
      .limit(1);
    assert.ok(agentsUsePermission);

    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: agentsUsePermission.id });

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-plans-no-perm-${runId}@example.com`;

    const [user] = await db
      .insert(users)
      .values({ name: 'Usuário Teste Sem Permission de Plano', email, passwordHash, roleId: role.id, isActive: true })
      .returning();
    noPlanPermUserId = user.id;

    noPlanPermToken = await login(email, 'senha-teste-12345');

    // Para o teste de risco alto: reaproveita uma tool read já seedada
    // (sales.get_pipeline_summary) e sobe temporariamente seu `risk` para
    // 'high' dentro do próprio teste — evita inserir uma tool nova com
    // handler que não existe no registry (getTool() rejeitaria).
    const [salesAgent] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    assert.ok(salesAgent, 'Agente sales do seed não encontrado.');

    const [existingReadTool] = await db
      .select()
      .from(agentTools)
      .where(eq(agentTools.handler, 'sales.get_pipeline_summary'))
      .limit(1);
    assert.ok(existingReadTool, 'Tool sales.get_pipeline_summary do seed não encontrada.');
    highRiskToolId = existingReadTool.id;
  });

  afterEach(() => {
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;
    delete process.env.AGENT_LLM_MIN_CONFIDENCE;
    setLLMProviderOverrideForTests(null);
  });

  after(async () => {
    await db
      .update(agentTools)
      .set({ risk: 'read', mutatesData: false, requiresApproval: false })
      .where(eq(agentTools.id, highRiskToolId));

    if (createdPlanIds.length > 0) {
      await db.delete(agentActionPlans).where(inArray(agentActionPlans.id, createdPlanIds));
    }

    await db.delete(users).where(eq(users.id, noPlanPermUserId));
    await db.delete(roles).where(eq(roles.id, noPlanPermRoleId));

    await database.end();
    redis.disconnect();
  });

  test('POST /agents/action-plans sem agents.plan → 403', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    setLLMProviderOverrideForTests(mockProvider({ objective: 'x', summary: 'x', actions: [] }));

    const response = await createPlan(noPlanPermToken);

    assert.equal(response.statusCode, 403);
  });

  test('AGENT_LLM_ENABLED=false → 503 llm_unavailable', async () => {
    process.env.AGENT_LLM_ENABLED = 'false';

    const response = await createPlan(ceoToken);

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, 'llm_unavailable');
  });

  test('LLM tenta enviar SQL/campo fora do schema → rejeitado pelo .strict(), plano vazio é aceito', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Objetivo malicioso',
        summary: 'resumo',
        actions: [],
        sql: 'DROP TABLE users;',
      }),
    );

    const response = await createPlan(ceoToken);

    // .strict() rejeita o payload inteiro (campo "sql" não faz parte do
    // schema) — vira invalid_output no planner, não um plano com o campo
    // ignorado silenciosamente.
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error, 'planning_failed');
  });

  test('plano com tool inexistente proposta pelo LLM → validation_error, nada é persistido', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Objetivo',
        summary: 'resumo',
        actions: [
          {
            id: 'action-1',
            agent: 'sales',
            tool: 'sales.delete_everything',
            arguments: {},
            reason: 'motivo',
            confidence: 0.9,
          },
        ],
      }),
    );

    const response = await createPlan(ceoToken);

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'validation_error');

    const plans = await db.select().from(agentActionPlans).where(eq(agentActionPlans.objective, 'Objetivo'));
    assert.equal(plans.length, 0, 'nenhum plano deveria ter sido persistido para um Action Plan inválido.');
  });

  test('plano válido com ação read → executa automaticamente e completa', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Ver funil de vendas',
        summary: 'Consultar o resumo do funil',
        actions: [
          {
            id: 'action-1',
            agent: 'sales',
            tool: 'sales.get_pipeline_summary',
            arguments: {},
            reason: 'Usuário quer ver o funil',
            confidence: 0.95,
          },
        ],
      }),
    );

    const response = await createPlan(ceoToken);

    assert.equal(response.statusCode, 201, response.body);
    const body = response.json().data;

    assert.equal(body.plan.status, 'completed');
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].decision, 'execute');
    assert.equal(body.items[0].executionStatus, 'completed');
    assert.ok(body.items[0].result);
  });

  test('ação de risco alto → approval_required sempre, mesmo com confidence 1', async () => {
    await db
      .update(agentTools)
      .set({ risk: 'high', mutatesData: true, requiresApproval: false })
      .where(eq(agentTools.id, highRiskToolId));

    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Ação de alto risco',
        summary: 'resumo',
        actions: [
          {
            id: 'action-1',
            agent: 'sales',
            tool: 'sales.get_pipeline_summary',
            arguments: {},
            reason: 'motivo',
            confidence: 1,
          },
        ],
      }),
    );

    const response = await createPlan(ceoToken);
    assert.equal(response.statusCode, 201, response.body);

    const body = response.json().data;
    assert.equal(body.items[0].decision, 'approval_required');
    assert.equal(body.items[0].executionStatus, 'waiting_approval');
    assert.equal(body.plan.status, 'waiting_approval');

    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.planItemId, body.items[0].id));
    assert.ok(approval, 'uma solicitação de aprovação deveria ter sido criada para o item de alto risco.');
    assert.equal(approval.status, 'pending');

    // Aprovar via o endpoint único e generalizado de aprovações — deve
    // rodar a tool e completar o item/plano.
    const approveResponse = await app.inject({
      method: 'POST',
      url: `/agents/approvals/${approval.id}/approve`,
      headers: authHeader(ceoToken),
    });

    assert.equal(approveResponse.statusCode, 200, approveResponse.body);

    const [itemAfterApproval] = await db
      .select()
      .from(agentActionPlanItems)
      .where(eq(agentActionPlanItems.id, body.items[0].id));
    assert.equal(itemAfterApproval.executionStatus, 'completed');

    const [planAfterApproval] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, body.plan.id));
    assert.equal(planAfterApproval.status, 'completed');
  });

  test('ação de risco alto rejeitada → item nunca executa', async () => {
    await db
      .update(agentTools)
      .set({ risk: 'high', mutatesData: true, requiresApproval: false })
      .where(eq(agentTools.id, highRiskToolId));

    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Ação de alto risco para rejeitar',
        summary: 'resumo',
        actions: [
          {
            id: 'action-1',
            agent: 'sales',
            tool: 'sales.get_pipeline_summary',
            arguments: {},
            reason: 'motivo',
            confidence: 1,
          },
        ],
      }),
    );

    const response = await createPlan(ceoToken);
    const body = response.json().data;

    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.planItemId, body.items[0].id));

    const rejectResponse = await app.inject({
      method: 'POST',
      url: `/agents/approvals/${approval.id}/reject`,
      headers: authHeader(ceoToken),
    });

    assert.equal(rejectResponse.statusCode, 200, rejectResponse.body);

    const [itemAfterReject] = await db
      .select()
      .from(agentActionPlanItems)
      .where(eq(agentActionPlanItems.id, body.items[0].id));
    assert.equal(itemAfterReject.executionStatus, 'rejected');
    assert.equal(itemAfterReject.result, null, 'item rejeitado nunca deveria ter um resultado de execução.');
  });

  test('Shadow Mode ativo: ação que muta dados vira shadow e nunca executa', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'true';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Registrar acompanhamento em shadow mode',
        summary: 'resumo',
        actions: [
          {
            id: 'action-1',
            agent: 'customer_success',
            tool: 'cs.create_internal_followup_activity',
            arguments: { accountId: 999999, title: 'Follow-up de teste' },
            reason: 'motivo',
            confidence: 0.95,
          },
        ],
      }),
    );

    const response = await createPlan(ceoToken);
    assert.equal(response.statusCode, 201, response.body);

    const body = response.json().data;
    assert.equal(body.items[0].decision, 'shadow');
    assert.equal(body.items[0].executionStatus, 'skipped');
    assert.equal(body.items[0].result, null);
  });

  test('GET /agents/action-plans e GET /agents/action-plans/:id retornam o plano criado', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({ objective: 'Objetivo listagem', summary: 'resumo', actions: [] }),
    );

    const created = await createPlan(ceoToken, 'Objetivo listagem');
    const planId = created.json().data.plan.id as number;

    const listResponse = await app.inject({
      method: 'GET',
      url: '/agents/action-plans',
      headers: authHeader(ceoToken),
    });

    assert.equal(listResponse.statusCode, 200);
    assert.ok(listResponse.json().data.some((plan: { id: number }) => plan.id === planId));

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/agents/action-plans/${planId}`,
      headers: authHeader(ceoToken),
    });

    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().data.plan.id, planId);
    assert.deepEqual(detailResponse.json().data.items, []);
  });
});
