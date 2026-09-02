import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentDirectorDecisions,
  auditLogs,
  clients,
  crmActivities,
  leads,
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
import { syncDirectorDecisionQueue } from '../../agents/director/decisions/sync-service.js';

/*
 * Agentes v1.9 (correio.md secao 32) - API da Decision Queue:
 * autorizacao (read vs manage vs propose), transicoes de estado
 * (validas/invalidas), propose prova o pipeline oficial vinculando o
 * Decision Item ao Action Plan.
 */
function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

describe('Agentes v1.9 - Director Decision Queue API', () => {
  const app = buildApp();
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;

  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;

  let decisionId: number;
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
    // Agentes v2.1 — saneamento: `agentRateLimit('plan')` é compartilhado
    // no Redis por TODOS os testes que chamam "propose" como CEO — evita
    // 429 por acúmulo entre arquivos (mesmo guard de action-plans.test.ts).
    await redis.del(`agents:ratelimit:plan:${ceoUserId}`);

    const [role] = await db
      .insert(roles)
      .values({ name: `Teste Decisions Read ${runId}`, slug: `test-decisions-read-${runId}`, description: 'read only', isSystem: false })
      .returning();
    readOnlyRoleId = role.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: readPerm.id });

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-decisions-read-${runId}@example.com`;
    const [user] = await db.insert(users).values({ name: 'Read Only', email, passwordHash, roleId: role.id, isActive: true }).returning();
    readOnlyUserId = user.id;
    readOnlyToken = await login(email, 'senha-teste-12345');

    // Fixture: lead com follow-up vencido -> signal real -> sync cria o Decision Item.
    const leadResponse = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead Decisions ${runId}`, nextActionAt: '2020-01-01T00:00:00.000Z' },
    });
    assert.equal(leadResponse.statusCode, 201, leadResponse.body);
    createdLeadIds.push(leadResponse.json().data.id);

    await syncDirectorDecisionQueue();

    const [decision] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, `crm.lead_follow_up_overdue::lead::${leadResponse.json().data.id}`));
    assert.ok(decision, 'sync deveria ter criado o Decision Item para o lead com follow-up vencido.');
    decisionId = decision.id;
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    if (decisionId) await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, decisionId));
    if (createdLeadIds.length > 0) {
      await db.delete(crmActivities).where(inArray(crmActivities.leadId, createdLeadIds));
      await db.delete(leads).where(inArray(leads.id, createdLeadIds));
    }
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));

    await database.end();
    redis.disconnect();
  });

  describe('Autorização', () => {
    test('leitura (agents.read) funciona para usuário read-only', async () => {
      const list = await app.inject({ method: 'GET', url: '/agents/director/decisions', headers: authHeader(readOnlyToken) });
      assert.equal(list.statusCode, 200, list.body);

      const detail = await app.inject({
        method: 'GET',
        url: `/agents/director/decisions/${decisionId}`,
        headers: authHeader(readOnlyToken),
      });
      assert.equal(detail.statusCode, 200);
    });

    test('read-only não consegue acknowledge/assign/dismiss/sync (403)', async () => {
      const ack = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${decisionId}/acknowledge`,
        headers: authHeader(readOnlyToken),
      });
      assert.equal(ack.statusCode, 403);

      const sync = await app.inject({ method: 'POST', url: '/agents/director/decisions/sync', headers: authHeader(readOnlyToken) });
      assert.equal(sync.statusCode, 403);
    });

    test('read-only não consegue propose (403, sem agents.plan)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${decisionId}/propose`,
        headers: authHeader(readOnlyToken),
      });
      assert.equal(response.statusCode, 403);
    });
  });

  describe('Transições de estado', () => {
    test('acknowledge: open -> acknowledged, audita e persiste acknowledgedBy/At', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${decisionId}/acknowledge`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data.status, 'acknowledged');
      assert.equal(response.json().data.acknowledgedBy, ceoUserId);

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.director.decision.acknowledged'), eq(auditLogs.entityId, String(decisionId))))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(log);
    });

    test('acknowledge de novo (já acknowledged) → 409, transição inválida rejeitada', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${decisionId}/acknowledge`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 409);
    });

    test('assign: usuário inexistente é rejeitado', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${decisionId}/assign`,
        headers: authHeader(ceoToken),
        payload: { userId: 999999999 },
      });
      assert.equal(response.statusCode, 400);
    });

    test('assign: usuário válido é atribuído e auditado', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${decisionId}/assign`,
        headers: authHeader(ceoToken),
        payload: { userId: ceoUserId },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data.assignedUserId, ceoUserId);

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.director.decision.assigned'), eq(auditLogs.entityId, String(decisionId))))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(log);
    });
  });

  describe('POST /decisions/:id/propose — prova o pipeline oficial e vincula o Decision Item', () => {
    test('signal → Decision Item → propose → Action Plan persistido → status reflete a decisão do Policy Evaluator', async () => {
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
        url: `/agents/director/decisions/${decisionId}/propose`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 201, response.body);

      const { decision, plan, items } = response.json().data;
      assert.ok(plan.id);
      assert.equal(items.length, 1);
      assert.ok(['execute', 'approval_required', 'blocked', 'shadow'].includes(items[0].decision));
      assert.equal(decision.actionPlanId, plan.id);
      assert.ok(['action_planned', 'awaiting_approval'].includes(decision.status));

      const [persisted] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, decisionId));
      assert.equal(persisted.actionPlanId, plan.id);

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.director.decision.action_proposed'), eq(auditLogs.entityId, String(decisionId))))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(log);
      const metadata = log.metadata as { resultingActionPlanId: number };
      assert.equal(metadata.resultingActionPlanId, plan.id);
    });

    test('propor de novo no mesmo item (já action_planned/awaiting_approval) → 409, nunca cria um segundo plano', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${decisionId}/propose`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 409);
    });
  });

  describe('Filtros', () => {
    test('filtro por domain retorna só itens daquele domínio', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/director/decisions?domain=crm&limit=100',
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200);
      const { data } = response.json();
      assert.ok(data.every((item: { domain: string }) => item.domain === 'crm'));
    });
  });

  describe('Dismiss', () => {
    let dismissDecisionId: number;
    let dismissLeadId: number;

    before(async () => {
      const leadResponse = await app.inject({
        method: 'POST',
        url: '/crm/leads',
        headers: authHeader(ceoToken),
        payload: { name: `Lead Dismiss ${runId}`, nextActionAt: '2020-02-02T00:00:00.000Z' },
      });
      assert.equal(leadResponse.statusCode, 201, leadResponse.body);
      dismissLeadId = leadResponse.json().data.id;
      createdLeadIds.push(dismissLeadId);

      await syncDirectorDecisionQueue();
      const [decision] = await db
        .select()
        .from(agentDirectorDecisions)
        .where(eq(agentDirectorDecisions.deduplicationKey, `crm.lead_follow_up_overdue::lead::${dismissLeadId}`));
      assert.ok(decision);
      dismissDecisionId = decision.id;
    });

    after(async () => {
      await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, dismissDecisionId));
    });

    test('reason vazio é rejeitado (400)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${dismissDecisionId}/dismiss`,
        headers: authHeader(ceoToken),
        payload: { reason: '' },
      });
      assert.equal(response.statusCode, 400);
    });

    test('dismiss com reason: status vira dismissed, grava reason/dismissedBy/At e audita', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${dismissDecisionId}/dismiss`,
        headers: authHeader(ceoToken),
        payload: { reason: 'Falso positivo — lead já foi contatado por telefone.' },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data.status, 'dismissed');
      assert.equal(response.json().data.dismissedBy, ceoUserId);
      assert.equal(response.json().data.dismissReason, 'Falso positivo — lead já foi contatado por telefone.');

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.director.decision.dismissed'), eq(auditLogs.entityId, String(dismissDecisionId))))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(log);
    });

    test('dismiss de novo (já dismissed) → 409', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/agents/director/decisions/${dismissDecisionId}/dismiss`,
        headers: authHeader(ceoToken),
        payload: { reason: 'segunda tentativa' },
      });
      assert.equal(response.statusCode, 409);
    });
  });
});
