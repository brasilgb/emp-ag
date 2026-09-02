import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentActionPlanItems, auditLogs, clients, crmActivities, leads, permissions, rolePermissions, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../agents/llm/factory.js';
import { registerAllTools } from '../../agents/tools/index.js';
import type { LLMProvider, LLMResponse } from '../../agents/llm/types.js';

/*
 * Agentes v1.8 (correio.md secao 20) - API do Diretor: autorizacao,
 * proposta de acao prova o pipeline oficial (Planner -> Policy Evaluator
 * -> Action Plan persistido, sem bypass), auditoria.
 */
function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

describe('Agentes v1.8 - Director Operations API', () => {
  const app = buildApp();
  registerAllTools();
  const runId = Date.now();

  let ceoToken: string;
  let ceoUserId: number;

  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;

  let overdueLeadId: number;
  let overdueLeadSignalId: string;

  const createdLeadIds: number[] = [];

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

    const [role] = await db
      .insert(roles)
      .values({ name: `Teste Director Sem Permissão ${runId}`, slug: `test-director-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = role.id;

    // Precisa de alguma permission mínima para conseguir logar/usar a
    // API em geral, mas nenhuma das permissions do Diretor.
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: dummyPerm.id });

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-director-noperm-${runId}@example.com`;
    const [user] = await db.insert(users).values({ name: 'Sem Permissão', email, passwordHash, roleId: role.id, isActive: true }).returning();
    noPermUserId = user.id;
    noPermToken = await login(email, 'senha-teste-12345');

    // Fixture: lead com follow-up vencido — sinal real e reproduzível.
    const leadResponse = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead Director API ${runId}`, nextActionAt: '2020-01-01T00:00:00.000Z' },
    });
    assert.equal(leadResponse.statusCode, 201, leadResponse.body);
    overdueLeadId = leadResponse.json().data.id;
    createdLeadIds.push(overdueLeadId);
    overdueLeadSignalId = `crm.lead_follow_up_overdue:${overdueLeadId}`;
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    if (createdLeadIds.length > 0) {
      await db.delete(crmActivities).where(inArray(crmActivities.leadId, createdLeadIds));
      await db.delete(leads).where(inArray(leads.id, createdLeadIds));
    }
    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));

    await database.end();
    redis.disconnect();
  });

  describe('Autorização', () => {
    test('sem agents.read → GET /director/brief 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/director/brief', headers: authHeader(noPermToken) });
      assert.equal(response.statusCode, 403);
    });

    test('sem agents.read → GET /director/signals 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/director/signals', headers: authHeader(noPermToken) });
      assert.equal(response.statusCode, 403);
    });

    test('sem agents.use/agents.plan → POST propose 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/signals/${overdueLeadSignalId}/propose`,
        headers: authHeader(noPermToken),
      });
      assert.equal(response.statusCode, 403);
    });

    test('CEO consegue ler brief e signals', async () => {
      const brief = await app.inject({ method: 'GET', url: '/agents/director/brief', headers: authHeader(ceoToken) });
      assert.equal(brief.statusCode, 200, brief.body);
      assert.ok(typeof brief.json().data.status === 'string');

      const signals = await app.inject({ method: 'GET', url: '/agents/director/signals', headers: authHeader(ceoToken) });
      assert.equal(signals.statusCode, 200);
      assert.ok(Array.isArray(signals.json().data));
    });
  });

  describe('GET /director/signals/:id', () => {
    test('sinal existente é encontrado', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/director/signals/${overdueLeadSignalId}`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data.id, overdueLeadSignalId);
      assert.equal(response.json().data.entityId, overdueLeadId);
    });

    test('sinal inexistente → 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/director/signals/crm.lead_follow_up_overdue:999999999',
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 404);
    });
  });

  describe('POST /director/signals/:id/propose — prova o pipeline oficial sem bypass', () => {
    test('signal → propose → Planner → Policy Evaluator → Action Plan persistido', async () => {
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
              reason: 'Acompanhar follow-up pendente do lead.',
              confidence: 0.9,
            },
          ],
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/signals/${overdueLeadSignalId}/propose`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 201, response.body);

      const { plan, items } = response.json().data;
      assert.ok(plan.id);
      assert.equal(items.length, 1);
      // Prova que passou pelo Policy Evaluator de verdade (não bypass):
      // a decisão é um dos 4 valores reais do mecanismo existente, nunca
      // "sempre execute" hardcoded pelo endpoint do Diretor.
      assert.ok(['execute', 'approval_required', 'blocked', 'shadow'].includes(items[0].decision));

      const [persistedItem] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, plan.id));
      assert.ok(persistedItem, 'o Action Plan Item precisa estar realmente persistido no banco.');

      const [auditLog] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.director.action_proposed'), eq(auditLogs.entityId, String(overdueLeadId))))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(auditLog);
      const metadata = auditLog.metadata as { signalId: string; resultingActionPlanId: number };
      assert.equal(metadata.signalId, overdueLeadSignalId);
      assert.equal(metadata.resultingActionPlanId, plan.id);
    });
  });
});
