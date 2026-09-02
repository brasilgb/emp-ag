import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../../app.js';
import { db } from '../../../db/index.js';
import { agentDirectorDecisions, crmActivities, leads } from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../llm/factory.js';
import { registerAllTools } from '../../tools/index.js';
import type { LLMProvider, LLMResponse } from '../../llm/types.js';

import { syncDirectorDecisionQueue } from './sync-service.js';

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

/*
 * Agentes v1.9 (correio.md secao 34 "Cenario integrado obrigatorio") -
 * fluxo completo com componentes reais (entidade de negocio real via
 * HTTP, sync real, Postgres real); so o provider LLM e mockado, para
 * determinismo (o proprio correio.md permite isso explicitamente).
 */
describe('Agentes v1.9 - Cenário integrado obrigatório (correio.md seção 34)', () => {
  const app = buildApp();
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;
  let leadId: number;
  let dedupKey: string;

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200);
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

    const { db: dbModule } = await import('../../../db/index.js');
    const { users } = await import('../../../db/schema/index.js');
    const [ceoUser] = await dbModule.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    ceoUserId = ceoUser.id;
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    if (dedupKey) await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.deduplicationKey, dedupKey));
    if (leadId) {
      await db.delete(crmActivities).where(inArray(crmActivities.leadId, [leadId]));
      await db.delete(leads).where(eq(leads.id, leadId));
    }

    await database.end();
    redis.disconnect();
  });

  test('1-13: entidade real → signal → sync cria item → sync de novo não duplica → propose → Planner → Policy Evaluator → Action Plan persistido → status do item reflete → condição original resolvida → sync → item resolved', async () => {
    // 1. Inserir entidade de negócio real que gere signal: lead com
    // follow-up vencido (crm.lead_follow_up_overdue).
    const leadResponse = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead Cenário Integrado ${runId}`, nextActionAt: '2020-03-03T00:00:00.000Z' },
    });
    assert.equal(leadResponse.statusCode, 201, leadResponse.body);
    leadId = leadResponse.json().data.id;
    dedupKey = `crm.lead_follow_up_overdue::lead::${leadId}`;

    // 2. Sincronizar a Director Decision Queue.
    const firstSync = await syncDirectorDecisionQueue();
    assert.ok(firstSync.created >= 1);

    // 3. Confirmar Decision Item criado.
    const [created] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.deduplicationKey, dedupKey));
    assert.ok(created, 'Decision Item deveria existir após o primeiro sync.');
    assert.equal(created.status, 'open');
    const decisionId = created.id;

    // 4. Executar nova sincronização.
    const secondSync = await syncDirectorDecisionQueue();

    // 5. Confirmar que não duplicou.
    const rowsAfterSecondSync = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.deduplicationKey, dedupKey));
    assert.equal(rowsAfterSecondSync.length, 1, 'a segunda sincronização não pode criar um segundo Decision Item para a mesma entidade.');
    assert.equal(rowsAfterSecondSync[0].occurrenceCount, 2);
    assert.equal(secondSync.created, 0);

    // 6. Propor ação.
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Fazer follow-up do lead',
        summary: 'Registrar atividade de follow-up',
        actions: [
          {
            id: 'action-1',
            agent: 'sales',
            tool: 'sales.get_pipeline_summary',
            arguments: {},
            reason: 'Acompanhar follow-up pendente.',
            confidence: 0.9,
          },
        ],
      }),
    );

    const proposeResponse = await app.inject({
      method: 'POST',
      url: `/agents/director/decisions/${decisionId}/propose`,
      headers: authHeader(ceoToken),
    });
    assert.equal(proposeResponse.statusCode, 201, proposeResponse.body);
    const { plan, items, decision: decisionAfterPropose } = proposeResponse.json().data;

    // 7/8. Passou pelo Planner e pelo Policy Evaluator de verdade — a
    // decisão de cada item é um dos 4 valores reais, nunca hardcoded.
    assert.ok(['execute', 'approval_required', 'blocked', 'shadow'].includes(items[0].decision));

    // 9. Confirmar Action Plan persistido.
    const { agentActionPlans } = await import('../../../db/schema/index.js');
    const [persistedPlan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, plan.id));
    assert.ok(persistedPlan);

    // 10. Confirmar estado do Decision Item.
    assert.equal(decisionAfterPropose.actionPlanId, plan.id);
    assert.ok(['action_planned', 'awaiting_approval'].includes(decisionAfterPropose.status));

    // 11. Resolver a condição original: atualizar o nextActionAt do
    // lead para o futuro (o mesmo efeito real de alguém fazer o
    // follow-up e reagendar).
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/crm/leads/${leadId}`,
      headers: authHeader(ceoToken),
      payload: { nextActionAt: '2030-01-01T00:00:00.000Z' },
    });
    assert.equal(updateResponse.statusCode, 200, updateResponse.body);

    // 12. Sincronizar de novo.
    const thirdSync = await syncDirectorDecisionQueue();

    // 13. Confirmar resolved.
    assert.ok(thirdSync.resolved >= 1);
    const [resolvedRow] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.deduplicationKey, dedupKey));
    assert.equal(resolvedRow.status, 'resolved', 'a condição original não existe mais — o item deveria estar resolved.');
    assert.ok(resolvedRow.resolvedAt);
  });
});
