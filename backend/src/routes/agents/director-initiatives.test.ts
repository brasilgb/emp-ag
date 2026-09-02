import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentDirectorGoals, agentDirectorInitiatives, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../agents/llm/factory.js';
import { registerAllTools } from '../../agents/tools/index.js';
import type { LLMProvider, LLMResponse } from '../../agents/llm/types.js';

/*
 * Agentes v2.0 (correio.md seção 23/24) — Director Initiatives API:
 * ciclo de vida (proposed -> approved -> active -> completed), cancel,
 * e `propose` provando o pipeline OFICIAL de Action Plan — nunca a
 * partir de "proposed" (só depois de "approved").
 */
function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

describe('Agentes v2.0 - Director Initiatives API', () => {
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

  before(async () => {
    await app.ready();

    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    ceoToken = await login(ceoEmail, ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

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
    const created = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/initiatives`,
      headers: authHeader(ceoToken),
      payload: { title: 'x', description: 'x', domain: 'crm', rationale: 'x' },
    });
    const initiativeId = created.json().data.id;

    const propose = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
    assert.equal(propose.statusCode, 409, propose.body);
  });

  test('ciclo completo: approve -> propose (pipeline oficial) -> Action Plan vinculado -> complete', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
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
      }),
    );

    const created = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/initiatives`,
      headers: authHeader(ceoToken),
      payload: {
        title: `Iniciativa Completa ${runId}`,
        description: 'desc',
        domain: 'crm',
        rationale: 'racional',
      },
    });
    const initiativeId = created.json().data.id;

    const approve = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
    assert.equal(approve.statusCode, 200, approve.body);
    assert.equal(approve.json().data.status, 'approved');

    // approve de novo -> 409 (já aprovada).
    const approveAgain = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/approve`, headers: authHeader(ceoToken) });
    assert.equal(approveAgain.statusCode, 409);

    const propose = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
    assert.equal(propose.statusCode, 201, propose.body);
    const { initiative, plan, items } = propose.json().data;
    assert.ok(plan.id);
    assert.equal(items.length, 1);
    assert.ok(['execute', 'approval_required', 'blocked', 'shadow'].includes(items[0].decision));
    assert.equal(initiative.actionPlanId, plan.id);
    assert.equal(initiative.status, 'active');

    // propor de novo -> 409, nunca cria um segundo plano.
    const proposeAgain = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/propose`, headers: authHeader(ceoToken) });
    assert.equal(proposeAgain.statusCode, 409);

    const complete = await app.inject({ method: 'POST', url: `/agents/director/initiatives/${initiativeId}/complete`, headers: authHeader(ceoToken) });
    assert.equal(complete.statusCode, 200, complete.body);
    assert.equal(complete.json().data.status, 'completed');
    assert.ok(complete.json().data.completedAt);
  });

  test('cancel exige reason; initiative completed/cancelled não pode ser cancelada de novo', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/initiatives`,
      headers: authHeader(ceoToken),
      payload: { title: 'a cancelar', description: 'x', domain: 'crm', rationale: 'x' },
    });
    const initiativeId = created.json().data.id;

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
