import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentResponsibilities, agents, permissions, rolePermissions, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

/*
 * Agentes v2.6 (correio.md seção 18, itens 26-29) — API de Responsibilities:
 * autorização (read vs manage), CRUD completo, validação de payload,
 * segurança (payload extra rejeitado por .strict(), ids inválidos).
 */
describe('Agentes v2.6 - Responsibilities API', () => {
  const app = buildApp();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let salesAgentId: number;
  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;
  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;
  const responsibilityIds: number[] = [];

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

    const [sales] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    assert.ok(sales);
    salesAgentId = sales.id;

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);

    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste Resp ReadOnly ${runId}`, slug: `test-resp-readonly-${runId}`, description: 'read only', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.responsibilities.read')).limit(1);
    assert.ok(readPerm);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm.id });
    const readOnlyEmail = `test-resp-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only Resp', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');

    const [noPermRole] = await db
      .insert(roles)
      .values({ name: `Teste Resp SemPerm ${runId}`, slug: `test-resp-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const noPermEmail = `test-resp-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão Resp', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');
  });

  after(async () => {
    for (const id of responsibilityIds) {
      await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.responsibilityId, id));
      await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, id));
    }
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));
    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));

    await database.end();
    redis.disconnect();
  });

  test('26/sem permission → GET e POST retornam 403', async () => {
    const list = await app.inject({ method: 'GET', url: '/agents/responsibilities', headers: authHeader(noPermToken) });
    assert.equal(list.statusCode, 403);

    const create = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(noPermToken),
      payload: { agentId: salesAgentId, name: 'x', domain: 'crm', responsibilityType: 'monitor' },
    });
    assert.equal(create.statusCode, 403);
  });

  test('read-only (agents.responsibilities.read) consegue listar/ler, mas não criar/editar/excluir (403)', async () => {
    const list = await app.inject({ method: 'GET', url: '/agents/responsibilities', headers: authHeader(readOnlyToken) });
    assert.equal(list.statusCode, 200, list.body);

    const create = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(readOnlyToken),
      payload: { agentId: salesAgentId, name: 'x', domain: 'crm', responsibilityType: 'monitor' },
    });
    assert.equal(create.statusCode, 403);
  });

  test('POST cria Responsibility válida (201) e persiste', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(ceoToken),
      payload: { agentId: salesAgentId, name: `API Create ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'high' },
    });
    assert.equal(response.statusCode, 201, response.body);
    const { data } = response.json();
    responsibilityIds.push(data.id);
    assert.equal(data.priority, 'high');
    assert.equal(data.enabled, true);
  });

  test('27: payload com campo extra é rejeitado (schema .strict())', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(ceoToken),
      payload: { agentId: salesAgentId, name: 'x', domain: 'crm', responsibilityType: 'monitor', campoInventado: 'nunca deveria passar' },
    });
    assert.equal(response.statusCode, 400);
  });

  test('27: escalationPolicy=human sem escalationTargetUserId é rejeitado (400)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(ceoToken),
      payload: { agentId: salesAgentId, name: 'x', domain: 'crm', responsibilityType: 'monitor', escalationPolicy: 'human' },
    });
    assert.equal(response.statusCode, 400);
  });

  test('28: GET com id inválido (não numérico) → 400; id inexistente → 404', async () => {
    const invalid = await app.inject({ method: 'GET', url: '/agents/responsibilities/not-a-number', headers: authHeader(ceoToken) });
    assert.equal(invalid.statusCode, 400);

    const missing = await app.inject({ method: 'GET', url: '/agents/responsibilities/999999999', headers: authHeader(ceoToken) });
    assert.equal(missing.statusCode, 404);
  });

  test('PATCH altera e enable/disable funciona via API', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(ceoToken),
      payload: { agentId: salesAgentId, name: `API Patch ${runId}`, domain: 'crm', responsibilityType: 'monitor' },
    });
    const id = created.json().data.id;
    responsibilityIds.push(id);

    const patched = await app.inject({ method: 'PATCH', url: `/agents/responsibilities/${id}`, headers: authHeader(ceoToken), payload: { enabled: false } });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().data.enabled, false);
  });

  test('domain/agentId/responsibilityType são imutáveis via PATCH (schema não os aceita → 400 se enviados)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(ceoToken),
      payload: { agentId: salesAgentId, name: `API Imutável ${runId}`, domain: 'crm', responsibilityType: 'monitor' },
    });
    const id = created.json().data.id;
    responsibilityIds.push(id);

    const response = await app.inject({ method: 'PATCH', url: `/agents/responsibilities/${id}`, headers: authHeader(ceoToken), payload: { domain: 'finance' } });
    assert.equal(response.statusCode, 400, 'domain não deveria ser um campo aceito no PATCH');
  });

  test('DELETE remove Responsibility sem histórico (204); com histórico de escalation → 409', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(ceoToken),
      payload: { agentId: salesAgentId, name: `API Delete ${runId}`, domain: 'crm', responsibilityType: 'monitor' },
    });
    const id = created.json().data.id;

    const deleted = await app.inject({ method: 'DELETE', url: `/agents/responsibilities/${id}`, headers: authHeader(ceoToken) });
    assert.equal(deleted.statusCode, 204);

    const withHistory = await app.inject({
      method: 'POST',
      url: '/agents/responsibilities',
      headers: authHeader(ceoToken),
      payload: { agentId: salesAgentId, name: `API Delete c/ Histórico ${runId}`, domain: 'crm', responsibilityType: 'monitor' },
    });
    const historyId = withHistory.json().data.id;
    responsibilityIds.push(historyId);

    await db.insert(agentOperationalEscalations).values({
      responsibilityId: historyId,
      sourceAgentId: salesAgentId,
      reason: 'teste api',
      severity: 'info',
      status: 'open',
      dedupKey: `api-delete-history-${runId}`,
    });

    const blocked = await app.inject({ method: 'DELETE', url: `/agents/responsibilities/${historyId}`, headers: authHeader(ceoToken) });
    assert.equal(blocked.statusCode, 409);
  });
});
