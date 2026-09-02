import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { buildApp } from '../../../app.js';
import { db } from '../../../db/index.js';
import {
  agentActionPlanItems,
  agentApprovals,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentTools,
  agentToolPermissions,
  agents,
  users,
} from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../llm/factory.js';
import { registerAllTools } from '../../tools/index.js';
import type { LLMProvider, LLMResponse } from '../../llm/types.js';

import { evaluateDirectorGoal } from './evaluation-engine.js';
import { reviewDirectorGoals } from './review-service.js';

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

/*
 * Agentes v2.0 (correio.md seção 24 "Cenário integrado obrigatório") —
 * fluxo completo com DB real e componentes reais (Planner/Policy
 * Evaluator/Executor/Approval reais); só o provider LLM é mockado, para
 * determinismo (autorizado explicitamente pelo correio.md).
 */
describe('Agentes v2.0 - Cenário integrado obrigatório (correio.md seção 24)', () => {
  const app = buildApp();
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;
  let goalId: number;
  let initiativeId: number;
  let salesToolPermissionId: number | null = null;

  const START = new Date('2026-01-01T00:00:00.000Z');
  const TARGET = new Date('2026-01-31T00:00:00.000Z'); // 30 dias
  const NOW = new Date('2026-01-21T00:00:00.000Z'); // 20/30 dias decorridos (~67%), 0% de progresso simulado

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200);
    return response.json().token as string;
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
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    if (salesToolPermissionId) {
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, salesToolPermissionId));
    }
    if (initiativeId) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goalId));
    if (goalId) await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  test('1-13: Goal criado → ativado → métrica real → avaliação → at_risk/critical → recomendação sem duplicar → aprovada → propose (pipeline oficial) → Policy Evaluator → approval pendente → nenhuma execução automática', async () => {
    // 1. CEO cria Goal "Conquistar 20 clientes".
    const createResponse = await app.inject({
      method: 'POST',
      url: '/agents/director/goals',
      headers: authHeader(ceoToken),
      payload: {
        title: `Conquistar 20 clientes ${runId}`,
        description: 'Meta comercial do trimestre.',
        domain: 'crm',
        startDate: START.toISOString(),
        targetDate: TARGET.toISOString(),
        targetType: 'metric',
      },
    });
    assert.equal(createResponse.statusCode, 201, createResponse.body);
    goalId = createResponse.json().data.id;

    const metricResponse = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/metrics`,
      headers: authHeader(ceoToken),
      payload: { metricKey: 'crm.clients_won', targetValue: 20, weight: 1 },
    });
    assert.equal(metricResponse.statusCode, 201, metricResponse.body);

    // 2. Goal é ativado.
    const activateResponse = await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/activate`, headers: authHeader(ceoToken) });
    assert.equal(activateResponse.statusCode, 200, activateResponse.body);
    assert.equal(activateResponse.json().data.status, 'active');

    // 3/4. Métrica CRM retorna o valor real (via catálogo determinístico,
    // nunca inventado) e a Goal Evaluation Engine calcula o progresso.
    // 5. Cenário simula progresso insuficiente: `now` fixado a ~67% do
    // prazo decorrido, sem nenhum cliente novo desde `startDate`
    // (metric crm.clients_won conta clients.createdAt >= startDate —
    // como nenhum client foi criado neste teste, current fica 0, salvo
    // clients reais criados por outros processos no mesmo instante, o
    // que ainda manteria o progresso muito abaixo do target=20).
    const evalResult = await evaluateDirectorGoal(goalId, { now: NOW });
    assert.ok(evalResult);
    assert.ok(evalResult.evaluation.progressPercent < 50, 'progresso deveria estar bem abaixo do esperado para o cenário simulado.');

    // 6. Goal muda para at_risk (ou critical, se o desvio for mais severo).
    assert.ok(['at_risk', 'critical'].includes(evalResult.evaluation.health), `health inesperado: ${evalResult.evaluation.health}`);

    // 7/8. Director Review identifica o risco e gera recomendação, sem duplicar.
    const firstReview = await reviewDirectorGoals(NOW);
    assert.ok(firstReview.recommendationsCreated >= 1);

    const secondReview = await reviewDirectorGoals(NOW);
    const recommendationKey = `goal-health:${goalId}:${evalResult.evaluation.health}`;
    const [recommendation] = await db
      .select()
      .from(agentDirectorInitiatives)
      .where(and(eq(agentDirectorInitiatives.goalId, goalId), eq(agentDirectorInitiatives.recommendationKey, recommendationKey)));
    assert.ok(recommendation, 'reviewDirectorGoals deveria ter criado uma Initiative de recomendação.');
    assert.equal(recommendation.origin, 'director_recommendation');
    assert.equal(recommendation.status, 'proposed');
    initiativeId = recommendation.id;

    const stillOne = await db
      .select()
      .from(agentDirectorInitiatives)
      .where(and(eq(agentDirectorInitiatives.goalId, goalId), eq(agentDirectorInitiatives.recommendationKey, recommendationKey)));
    assert.equal(stillOne.length, 1, 'segunda chamada de reviewDirectorGoals não deveria duplicar a recomendação.');
    assert.ok(secondReview.evaluated >= 1);

    // 9. Usuário aprova a Initiative.
    const approveResponse = await app.inject({
      method: 'POST',
      url: `/agents/director/initiatives/${initiativeId}/approve`,
      headers: authHeader(ceoToken),
    });
    assert.equal(approveResponse.statusCode, 200, approveResponse.body);
    assert.equal(approveResponse.json().data.status, 'approved');

    // Força approval_required deterministicamente para a tool usada pelo
    // mock (override real de agente↔tool, seção 21: "aumenta prioridade
    // não pode ignorar approvals" — usamos o mecanismo OFICIAL de
    // approval override, nunca um bypass inventado para o teste).
    const [salesAgent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, 'sales')).limit(1);
    const [salesTool] = await db.select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
    assert.ok(salesAgent && salesTool);
    const [toolPermission] = await db
      .select()
      .from(agentToolPermissions)
      .where(and(eq(agentToolPermissions.agentId, salesAgent.id), eq(agentToolPermissions.toolId, salesTool.id)))
      .limit(1);
    assert.ok(toolPermission, 'agente sales deveria já ter permission para sales.get_pipeline_summary (seed).');
    salesToolPermissionId = toolPermission.id;
    await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, toolPermission.id));

    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Executar iniciativa recomendada pelo Director Goal Review',
        summary: 'Levantar situação do funil para reforçar a meta',
        actions: [
          {
            id: 'action-1',
            agent: 'sales',
            tool: 'sales.get_pipeline_summary',
            arguments: {},
            reason: 'Entender o funil atual antes de agir sobre a meta em risco.',
            confidence: 0.95,
          },
        ],
      }),
    );

    // 10. propose gera Action Plan através do Planner oficial.
    const proposeResponse = await app.inject({
      method: 'POST',
      url: `/agents/director/initiatives/${initiativeId}/propose`,
      headers: authHeader(ceoToken),
    });
    assert.equal(proposeResponse.statusCode, 201, proposeResponse.body);
    const { plan, items, initiative: initiativeAfterPropose } = proposeResponse.json().data;

    // 11. Policy Evaluator avaliou o item — com o override, decision DEVE
    // ser approval_required (determinístico, não um dos 4 valores "ao acaso").
    assert.equal(items.length, 1);
    assert.equal(items[0].decision, 'approval_required');
    assert.equal(initiativeAfterPropose.actionPlanId, plan.id);

    // 12. Ação que exige approval continua aguardando approval — nunca
    // executada automaticamente só porque o Goal está em risco.
    const [persistedItem] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.id, items[0].id));
    assert.ok(persistedItem);
    assert.equal(persistedItem.executionStatus, 'waiting_approval');

    const [pendingApproval] = await db
      .select()
      .from(agentApprovals)
      .where(and(eq(agentApprovals.planItemId, persistedItem.id), eq(agentApprovals.status, 'pending')));
    assert.ok(pendingApproval, 'deveria existir um Approval real pendente — não um mecanismo paralelo.');

    // 13. Nenhuma ação foi executada automaticamente apenas por o Goal
    // estar em risco — reforça a garantia acima com uma leitura direta
    // do estado real do plano.
    assert.notEqual(persistedItem.executionStatus, 'completed');
  });
});
