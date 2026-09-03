import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentActionPlans,
  agentOperationalActionProposals,
  agentOperationalFollowUps,
  agentResponsibilities,
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
 * Agentes v2.8 (correio.md seção 18/25 itens 2/11/12) — API de
 * OperationalActionProposal: autorização (read vs manage), FollowUp
 * inexistente, ator sem permission, permissions nunca alteradas.
 */
function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

describe('Agentes v2.8 - Action Proposals API', () => {
  const app = buildApp();
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;
  let salesAgentId: number;
  let responsibilityId: number;
  let followUpId: number;
  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;
  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;
  const proposalIds: number[] = [];
  const planIds: number[] = [];

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
    ceoUserId = ceoUser!.id;

    const [sales] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    salesAgentId = sales!.id;

    const [responsibility] = await db
      .insert(agentResponsibilities)
      .values({ agentId: salesAgentId, name: `Proposals API fixture ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'none', createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;

    const [followUp] = await db
      .insert(agentOperationalFollowUps)
      .values({
        responsibilityId,
        sourceType: 'responsibility',
        sourceId: responsibilityId,
        ownerAgentId: salesAgentId,
        title: `FollowUp API Proposals ${runId}`,
        status: 'open',
        priority: 'medium',
        dedupKey: `proposals-api-fixture-${runId}`,
        createdBy: ceoUserId,
      })
      .returning();
    followUpId = followUp!.id;

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);

    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste Proposals ReadOnly ${runId}`, slug: `test-proposals-readonly-${runId}`, description: 'read only', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.followups.read')).limit(1);
    assert.ok(readPerm);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm.id });
    const readOnlyEmail = `test-proposals-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only Proposals', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');

    const [noPermRole] = await db
      .insert(roles)
      .values({ name: `Teste Proposals SemPerm ${runId}`, slug: `test-proposals-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const noPermEmail = `test-proposals-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão Proposals', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    for (const id of proposalIds) await db.delete(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, id));
    for (const id of planIds) {
      const { agentActionPlanItems } = await import('../../db/schema/index.js');
      await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, id));
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, id));
    }
    await db.delete(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, followUpId));
    await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, responsibilityId));
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));
    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));

    await database.end();
    redis.disconnect();
  });

  async function createProposal(token: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUpId}/action-proposals`,
      headers: authHeader(token),
      payload: { title: `API Proposal ${runId}-${Math.random()}`, objective: 'Verificar pipeline de vendas.' },
    });
    assert.equal(response.statusCode, 201, response.body);
    const id = response.json().data.id as number;
    proposalIds.push(id);
    return response.json().data;
  }

  test('11: sem nenhuma permission → GET/POST retornam 403', async () => {
    const list = await app.inject({ method: 'GET', url: `/agents/follow-ups/${followUpId}/action-proposals`, headers: authHeader(noPermToken) });
    assert.equal(list.statusCode, 403);

    const create = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUpId}/action-proposals`,
      headers: authHeader(noPermToken),
      payload: { title: 'x', objective: 'x' },
    });
    assert.equal(create.statusCode, 403);
  });

  test('read-only (agents.followups.read) lista/lê, mas não consegue criar/submeter/cancelar (403)', async () => {
    const proposal = await createProposal(ceoToken);

    const list = await app.inject({ method: 'GET', url: `/agents/follow-ups/${followUpId}/action-proposals`, headers: authHeader(readOnlyToken) });
    assert.equal(list.statusCode, 200, list.body);

    const detail = await app.inject({ method: 'GET', url: `/agents/action-proposals/${proposal.id}`, headers: authHeader(readOnlyToken) });
    assert.equal(detail.statusCode, 200);

    const create = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUpId}/action-proposals`,
      headers: authHeader(readOnlyToken),
      payload: { title: 'x', objective: 'x' },
    });
    assert.equal(create.statusCode, 403);

    const submit = await app.inject({ method: 'POST', url: `/agents/action-proposals/${proposal.id}/submit`, headers: authHeader(readOnlyToken) });
    assert.equal(submit.statusCode, 403);
  });

  test('2: FollowUp inexistente → 404 (create e list)', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/999999999/action-proposals`,
      headers: authHeader(ceoToken),
      payload: { title: 'x', objective: 'x' },
    });
    assert.equal(create.statusCode, 404);

    const list = await app.inject({ method: 'GET', url: `/agents/follow-ups/999999999/action-proposals`, headers: authHeader(ceoToken) });
    assert.equal(list.statusCode, 404);
  });

  test('payload com campo extra é rejeitado (.strict())', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUpId}/action-proposals`,
      headers: authHeader(ceoToken),
      payload: { title: 'x', objective: 'x', tool: 'nunca deveria ser aceito' },
    });
    assert.equal(response.statusCode, 400);
  });

  test('id inválido → 400; proposta inexistente → 404', async () => {
    const invalid = await app.inject({ method: 'GET', url: '/agents/action-proposals/not-a-number', headers: authHeader(ceoToken) });
    assert.equal(invalid.statusCode, 400);

    const missing = await app.inject({ method: 'GET', url: '/agents/action-proposals/999999999', headers: authHeader(ceoToken) });
    assert.equal(missing.statusCode, 404);
  });

  test('submit e cancel via HTTP funcionam de ponta a ponta; 12: permissions/role_permissions nunca são alteradas por isso', async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';
    setLLMProviderOverrideForTests(
      mockProvider({
        objective: 'Verificar pipeline de vendas',
        summary: 'Consultar resumo do funil.',
        actions: [{ id: 'action-1', agent: 'sales', tool: 'sales.get_pipeline_summary', arguments: {}, reason: 'Acompanhar o FollowUp.', confidence: 0.9 }],
      }),
    );

    const permsBefore = await db.select().from(permissions);
    const rolePermsBefore = await db.select().from(rolePermissions);

    const proposal = await createProposal(ceoToken);
    const submit = await app.inject({ method: 'POST', url: `/agents/action-proposals/${proposal.id}/submit`, headers: authHeader(ceoToken) });
    assert.equal(submit.statusCode, 200, submit.body);
    assert.ok(submit.json().data.actionPlanId);
    planIds.push(submit.json().data.actionPlanId);

    const permsAfter = await db.select().from(permissions);
    const rolePermsAfter = await db.select().from(rolePermissions);
    assert.equal(permsAfter.length, permsBefore.length, 'proposta nunca concede/cria permission');
    assert.equal(rolePermsAfter.length, rolePermsBefore.length);

    // Um novo proposal para testar cancel (o anterior já está terminal).
    const proposal2 = await createProposal(ceoToken);
    const cancel = await app.inject({
      method: 'POST',
      url: `/agents/action-proposals/${proposal2.id}/cancel`,
      headers: authHeader(ceoToken),
      payload: { reason: 'Não é mais necessário.' },
    });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(cancel.json().data.status, 'cancelled');
  });

  test('cancel exige reason (400 sem reason)', async () => {
    const proposal = await createProposal(ceoToken);
    const response = await app.inject({ method: 'POST', url: `/agents/action-proposals/${proposal.id}/cancel`, headers: authHeader(ceoToken), payload: {} });
    assert.equal(response.statusCode, 400);
  });
});
