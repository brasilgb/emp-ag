import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import bcrypt from 'bcryptjs';

import {
  agentDirectorDecisions,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutiveReviews,
  agentToolPermissions,
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

  describe('POST/GET /director/initiatives/:id/review (correio.md v2.2 seção 14/15)', () => {
    let noPermToken: string;
    let noPermRoleId: number;
    let noPermUserId: number;

    before(async () => {
      const [role] = await db
        .insert(roles)
        .values({ name: `Teste Review Sem Permissão ${runId}`, slug: `test-review-noperm-${runId}`, description: 'sem permissions', isSystem: false })
        .returning();
      noPermRoleId = role!.id;

      const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionId: dummyPerm!.id });

      const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
      const email = `test-review-noperm-${runId}@example.com`;
      const [user] = await db.insert(users).values({ name: 'Sem Permissão Review', email, passwordHash, roleId: role!.id, isActive: true }).returning();
      noPermUserId = user!.id;
      noPermToken = await login(email, 'senha-teste-12345');
    });

    after(async () => {
      await db.delete(users).where(eq(users.id, noPermUserId));
      await db.delete(roles).where(eq(roles.id, noPermRoleId));
    });

    test('sem agents.director.initiatives.manage → POST .../review 403, nenhuma review criada', async () => {
      const initiativeId = await createInitiative(`Iniciativa Review SemPerm ${runId}`);

      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/initiatives/${initiativeId}/review`,
        headers: authHeader(noPermToken),
      });
      assert.equal(response.statusCode, 403);

      const rows = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.initiativeId, initiativeId));
      assert.equal(rows.length, 0, 'nenhuma review deveria ter sido criada — bloqueado antes do handler.');
    });

    test('GET .../review sem review ainda → data: null (nunca 404)', async () => {
      const initiativeId = await createInitiative(`Iniciativa Review Vazia ${runId}`);
      const response = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}/review`, headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data, null);
    });

    test('execução ainda não terminou → POST .../review é 409, nenhuma review criada', async () => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';

      const [salesAgent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, 'sales')).limit(1);
      const [salesTool] = await db.select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
      const [toolPermission] = await db
        .select()
        .from(agentToolPermissions)
        .where(and(eq(agentToolPermissions.agentId, salesAgent!.id), eq(agentToolPermissions.toolId, salesTool!.id)));
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, toolPermission!.id));

      try {
        setLLMProviderOverrideForTests(pipelineSummaryObjective());
        const initiativeId = await createInitiative(`Iniciativa Review Prematura ${runId}`);
        await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
        const propose = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
        assert.equal(propose.json().data.items[0].executionStatus, 'waiting_approval');

        const review = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/review`, headers: authHeader(ceoToken) });
        assert.equal(review.statusCode, 409, review.body);
      } finally {
        await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, toolPermission!.id));
      }
    });

    test('fluxo completo via HTTP: propose → auto-completed → POST review (201) → GET review devolve a mesma; segunda POST é idempotente (200)', async () => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
      setLLMProviderOverrideForTests(pipelineSummaryObjective());

      const initiativeId = await createInitiative(`Iniciativa Review Completa ${runId}`);
      await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
      const propose = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
      assert.equal(propose.json().data.initiative.status, 'completed', 'CEO tem permissão real — executa e completa na hora.');

      // Troca o provider para a saída estruturada da Executive Review
      // (formato diferente do Action Planner — o mesmo provider mockado
      // não serve para os dois papéis na mesma chamada).
      setLLMProviderOverrideForTests({
        name: 'mock-review',
        async complete() {
          return {
            raw: {
              outcome: 'successful',
              summary: 'Resumo executivo via HTTP.',
              assessment: 'Avaliação via HTTP, baseada na evidência real da execução.',
              confidence: 0.85,
              recommendation: { type: 'none', reason: 'Nenhuma ação adicional necessária.' },
            },
          };
        },
      });

      const review = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/review`, headers: authHeader(ceoToken) });
      assert.equal(review.statusCode, 201, review.body);
      assert.equal(review.json().data.outcome, 'successful');
      assert.equal(review.json().data.status, 'completed');
      const reviewId = review.json().data.id;

      const getReview = await app.inject({ method: 'GET', url: `/agents/director/initiatives/${initiativeId}/review`, headers: authHeader(ceoToken) });
      assert.equal(getReview.statusCode, 200, getReview.body);
      assert.equal(getReview.json().data.id, reviewId);

      const reviewAgain = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/review`, headers: authHeader(ceoToken) });
      assert.equal(reviewAgain.statusCode, 200, 'chamada idempotente devolve a mesma review, nunca 201 de novo');
      assert.equal(reviewAgain.json().data.id, reviewId);

      await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, reviewId));
    });

    test('recomendação escalate via HTTP: gera Decision Item real, visível na Director Decision Queue', async () => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
      setLLMProviderOverrideForTests(pipelineSummaryObjective());

      const initiativeId = await createInitiative(`Iniciativa Review Escalate ${runId}`);
      await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
      await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });

      setLLMProviderOverrideForTests({
        name: 'mock-review-escalate',
        async complete() {
          return {
            raw: {
              outcome: 'blocked',
              summary: 'Bloqueio real detectado.',
              assessment: 'Impedimento estrutural real requer decisão do CEO.',
              confidence: 0.8,
              recommendation: { type: 'escalate', reason: 'Decisão do CEO necessária para prosseguir.' },
            },
          };
        },
      });

      const review = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/review`, headers: authHeader(ceoToken) });
      assert.equal(review.statusCode, 201, review.body);
      assert.equal(review.json().data.recommendationType, 'escalate');
      const decisionId = review.json().data.resultingDecisionId;
      assert.ok(decisionId);

      const [decision] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, decisionId));
      assert.ok(decision);
      assert.equal(decision.status, 'open');
      assert.equal(decision.requiresHumanAttention, true);

      await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.json().data.id));
      await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, decisionId));
    });
  });

  test('GET /director/initiatives?goalId= filtra por Goal', async () => {
    const response = await app.inject({ method: 'GET', url: `/agents/director/initiatives?goalId=${goalId}&limit=100`, headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().data.every((initiative: { goalId: number }) => initiative.goalId === goalId));
    assert.ok(response.json().data.length >= 4);
  });
});
