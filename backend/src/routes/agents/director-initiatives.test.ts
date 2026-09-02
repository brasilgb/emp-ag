import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentDirectorGoals, agentDirectorInitiatives, agentToolPermissions, agentTools, agents, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../agents/llm/factory.js';
import { registerAllTools } from '../../agents/tools/index.js';
import type { LLMProvider, LLMResponse } from '../../agents/llm/types.js';

/*
 * Agentes v2.0/v2.1 (correio.md v2.1 seção 19) — Director Initiatives
 * API: ciclo de vida (proposed -> approved -> active -> blocked/
 * completed), cancel, e `propose` (agora `startInitiativeExecution` por
 * trás — mesma rota, nome mantido, correio.md v2.1 seção 12) provando o
 * pipeline OFICIAL de Action Plan e a conclusão automática por
 * evidência real (seção 8).
 */
function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

function pipelineSummaryObjective() {
  return mockProvider({
    objective: 'Executar iniciativa estratégica',
    summary: 'Preparar campanha',
    actions: [
      {
        id: 'action-1',
        agent: 'sales',
        tool: 'sales.get_pipeline_summary',
        arguments: {},
        reason: 'Levantar situação atual do funil para a iniciativa.',
        confidence: 0.9,
      },
    ],
  });
}

describe('Agentes v2.1 - Director Initiatives API', () => {
  const app = buildApp();
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;
  let goalId: number;

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createInitiative(title: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/initiatives`,
      headers: authHeader(ceoToken),
      payload: { title, description: 'desc', domain: 'crm', rationale: 'racional' },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().data.id as number;
  }

  before(async () => {
    await app.ready();

    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    ceoToken = await login(ceoEmail, ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;
    // Agentes v2.1 — saneamento: `agentRateLimit('plan')` é compartilhado
    // no Redis por TODOS os testes que chamam "propose" como CEO — evita
    // 429 por acúmulo entre arquivos (mesmo guard de action-plans.test.ts).
    await redis.del(`agents:ratelimit:plan:${ceoUserId}`);

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal p/ Initiatives ${runId}`,
        description: 'desc',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        createdBy: ceoUserId,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
        targetType: 'milestone',
      })
      .returning();
    goalId = goal!.id;
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goalId));
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  test('POST /director/goals/:goalId/initiatives cria como "proposed", origin=manual, audita', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/initiatives`,
      headers: authHeader(ceoToken),
      payload: {
        title: `Iniciativa Manual ${runId}`,
        description: 'Campanha de indicação de clientes.',
        domain: 'crm',
        rationale: 'Acelerar aquisição de clientes para bater a meta.',
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.status, 'proposed');
    assert.equal(response.json().data.origin, 'manual');
  });

  test('propose a partir de "proposed" (sem aprovação) é rejeitado — 409', async () => {
    const initiativeId = await createInitiative('x');

    const propose = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
    assert.equal(propose.statusCode, 409, propose.body);
  });

  test('GET /director/initiatives/:id/execution sem Action Plan → not_started', async () => {
    const initiativeId = await createInitiative('sem execução ainda');

    const response = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}/execution`, headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.execution.state, 'not_started');
    assert.equal(response.json().data.execution.actionPlanId, null);
  });

  describe('ciclo completo — auto-completado por evidência real (correio.md seção 8)', () => {
    test('approve -> propose (201, pipeline oficial) -> item execute completa na hora -> Initiative auto-completed', async () => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
      setLLMProviderOverrideForTests(pipelineSummaryObjective());

      const initiativeId = await createInitiative(`Iniciativa Completa ${runId}`);

      const approve = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
      assert.equal(approve.statusCode, 200, approve.body);
      assert.equal(approve.json().data.status, 'approved');

      // approve de novo -> 409 (já aprovada).
      const approveAgain = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
      assert.equal(approveAgain.statusCode, 409);

      const propose = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
      assert.equal(propose.statusCode, 201, propose.body);
      const { initiative, plan, items, created } = propose.json().data;
      assert.equal(created, true);
      assert.ok(plan.id);
      assert.equal(items.length, 1);
      assert.equal(items[0].decision, 'execute');
      assert.equal(initiative.actionPlanId, plan.id);
      // CEO tem permissão real para a tool (risco "read") — executa na
      // hora, sem approval pendente — a Initiative conclui sozinha
      // (correio.md seção 8: evidência determinística, não o LLM dizendo
      // que terminou).
      assert.equal(initiative.status, 'completed');
      assert.ok(initiative.completedAt);

      // propor de novo -> 409 (já terminal), nunca cria um segundo plano.
      const proposeAgain = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
      assert.equal(proposeAgain.statusCode, 409);

      // complete manual sobre uma Initiative já completed -> 409 (transição inválida).
      const completeAgain = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/complete`, headers: authHeader(ceoToken) });
      assert.equal(completeAgain.statusCode, 409);

      const execution = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}/execution`, headers: authHeader(ceoToken) });
      assert.equal(execution.statusCode, 200, execution.body);
      assert.equal(execution.json().data.execution.state, 'completed');
      assert.equal(execution.json().data.execution.progressPercent, 100);
      assert.equal(execution.json().data.initiative.status, 'completed');
    });
  });

  describe('conclusão manual — quando a execução fica em aberto (approval pendente)', () => {
    let salesToolPermissionId: number;

    before(async () => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';

      const [salesAgent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, 'sales')).limit(1);
      const [salesTool] = await db.select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
      assert.ok(salesAgent && salesTool);
      const [toolPermission] = await db
        .select()
        .from(agentToolPermissions)
        .where(and(eq(agentToolPermissions.agentId, salesAgent.id), eq(agentToolPermissions.toolId, salesTool.id)));
      assert.ok(toolPermission);
      salesToolPermissionId = toolPermission.id;
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, salesToolPermissionId));
    });

    after(async () => {
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, salesToolPermissionId));
    });

    test('saneamento seção 2: complete manual é REJEITADO (409) enquanto a execução não terminou — só permitido depois que TODA evidência existir', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryObjective());
      const initiativeId = await createInitiative(`Iniciativa Manual Complete ${runId}`);

      await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
      const propose = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
      assert.equal(propose.statusCode, 201, propose.body);
      assert.equal(propose.json().data.initiative.status, 'active');
      assert.equal(propose.json().data.items[0].executionStatus, 'waiting_approval');

      const execution = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}/execution`, headers: authHeader(ceoToken) });
      assert.equal(execution.json().data.execution.state, 'waiting_approval');
      assert.equal(execution.json().data.initiative.status, 'active', 'GET /execution não conclui sozinho quando ainda há approval pendente');

      // Complete manual enquanto ainda há approval pendente → 409, nunca permite "forçar" a conclusão.
      const completeTooEarly = await app.inject({
        method: 'POST',
        url: `/agents/director/initiatives/${initiativeId}/complete`,
        headers: authHeader(ceoToken),
      });
      assert.equal(completeTooEarly.statusCode, 409, completeTooEarly.body);

      // Aprova a ação real (mesmo mecanismo oficial de approval, v1.2) —
      // só ISSO faz a evidência existir de verdade.
      const detail = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}`, headers: authHeader(ceoToken) });
      const pendingApprovalId = detail.json().data.pendingApproval.id;
      const approveAction = await app.inject({
        method: 'POST',
        url: `/agents/approvals/${pendingApprovalId}/approve`,
        headers: authHeader(ceoToken),
      });
      assert.equal(approveAction.statusCode, 200, approveAction.body);

      const executionAfter = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}/execution`, headers: authHeader(ceoToken) });
      assert.equal(executionAfter.json().data.execution.state, 'completed');
      // GET /execution já sincroniza sozinho (seção 8) — a Initiative já devia estar completed aqui.
      assert.equal(executionAfter.json().data.initiative.status, 'completed');

      // Complete manual sobre uma Initiative que JÁ é completed -> 409 (transição inválida, não evidência insuficiente).
      const completeAfter = await app.inject({
        method: 'POST',
        url: `/agents/director/initiatives/${initiativeId}/complete`,
        headers: authHeader(ceoToken),
      });
      assert.equal(completeAfter.statusCode, 409, completeAfter.body);
    });

    test('saneamento seção 2: complete manual funciona quando chamado ANTES do GET /execution já ter sincronizado — mesma regra de evidência, só que via o endpoint manual', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryObjective());
      const initiativeId = await createInitiative(`Iniciativa Manual Complete Direto ${runId}`);

      await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
      await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });

      const detail = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}`, headers: authHeader(ceoToken) });
      const pendingApprovalId = detail.json().data.pendingApproval.id;
      await app.inject({ method: 'POST', url: `/agents/approvals/${pendingApprovalId}/approve`, headers: authHeader(ceoToken) });

      // Neste ponto o item já executou e completou de verdade (o approve
      // da ação já chama executeActionPlan por trás), mas ninguém leu
      // GET /execution ainda — o endpoint manual precisa calcular a
      // evidência sozinho, não depender de uma leitura prévia.
      const complete = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/complete`, headers: authHeader(ceoToken) });
      assert.equal(complete.statusCode, 200, complete.body);
      assert.equal(complete.json().data.status, 'completed');
      assert.ok(complete.json().data.completedAt);
    });
  });

  test('cancel exige reason; initiative completed/cancelled não pode ser cancelada de novo', async () => {
    const initiativeId = await createInitiative('a cancelar');

    const noReason = await app.inject({
      method: 'POST',
      url: `/agents/director/initiatives/${initiativeId}/cancel`,
      headers: authHeader(ceoToken),
      payload: { reason: '' },
    });
    assert.equal(noReason.statusCode, 400);

    const cancel = await app.inject({
      method: 'POST',
      url: `/agents/director/initiatives/${initiativeId}/cancel`,
      headers: authHeader(ceoToken),
      payload: { reason: 'Não faz mais sentido.' },
    });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(cancel.json().data.status, 'cancelled');

    const cancelAgain = await app.inject({
      method: 'POST',
      url: `/agents/director/initiatives/${initiativeId}/cancel`,
      headers: authHeader(ceoToken),
      payload: { reason: 'de novo' },
    });
    assert.equal(cancelAgain.statusCode, 409);
  });

  test('GET /director/initiatives?goalId= filtra por Goal', async () => {
    const response = await app.inject({ method: 'GET', url: `/agents/director/initiatives?goalId=${goalId}&limit=100`, headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().data.every((initiative: { goalId: number }) => initiative.goalId === goalId));
    assert.ok(response.json().data.length >= 4);
  });
});
