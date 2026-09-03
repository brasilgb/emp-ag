import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentOperationalFollowUps, agentResponsibilities, agents, permissions, rolePermissions, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

/*
 * Agentes v2.7 (correio.md seção 23, itens 15-18) — API de FollowUps:
 * autorização (read vs manage), criação gerencial, transições via HTTP,
 * transição inválida rejeitada, nenhum endpoint de PATCH livre de status.
 */
describe('Agentes v2.7 - FollowUps API', () => {
  const app = buildApp();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;
  let salesAgentId: number;
  let responsibilityId: number;
  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;
  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;
  const followUpIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createFollowUp(overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/follow-ups',
      headers: authHeader(ceoToken),
      payload: { responsibilityId, title: `API FollowUp ${runId}-${Math.random()}`, priority: 'medium', ...overrides },
    });
    assert.equal(response.statusCode, 201, response.body);
    const id = response.json().data.id as number;
    followUpIds.push(id);
    return response.json().data;
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
      .values({ agentId: salesAgentId, name: `FollowUps API fixture ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'none', createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);

    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste FU ReadOnly ${runId}`, slug: `test-fu-readonly-${runId}`, description: 'read only', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.followups.read')).limit(1);
    assert.ok(readPerm);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm.id });
    const readOnlyEmail = `test-fu-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only FU', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');

    const [noPermRole] = await db
      .insert(roles)
      .values({ name: `Teste FU SemPerm ${runId}`, slug: `test-fu-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const noPermEmail = `test-fu-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão FU', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');
  });

  after(async () => {
    for (const id of followUpIds) await db.delete(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, id));
    await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, responsibilityId));
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));
    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));

    await database.end();
    redis.disconnect();
  });

  test('15: sem nenhuma permission → GET e POST retornam 403', async () => {
    const list = await app.inject({ method: 'GET', url: '/agents/follow-ups', headers: authHeader(noPermToken) });
    assert.equal(list.statusCode, 403);

    const create = await app.inject({
      method: 'POST',
      url: '/agents/follow-ups',
      headers: authHeader(noPermToken),
      payload: { responsibilityId, title: 'x', priority: 'medium' },
    });
    assert.equal(create.statusCode, 403);
  });

  test('16/17: read-only lista/lê mas não consegue criar/transicionar (403)', async () => {
    const followUp = await createFollowUp();

    const list = await app.inject({ method: 'GET', url: '/agents/follow-ups', headers: authHeader(readOnlyToken) });
    assert.equal(list.statusCode, 200, list.body);

    const detail = await app.inject({ method: 'GET', url: `/agents/follow-ups/${followUp.id}`, headers: authHeader(readOnlyToken) });
    assert.equal(detail.statusCode, 200);

    const create = await app.inject({
      method: 'POST',
      url: '/agents/follow-ups',
      headers: authHeader(readOnlyToken),
      payload: { responsibilityId, title: 'x', priority: 'medium' },
    });
    assert.equal(create.statusCode, 403);

    const start = await app.inject({ method: 'POST', url: `/agents/follow-ups/${followUp.id}/start`, headers: authHeader(readOnlyToken) });
    assert.equal(start.statusCode, 403);
  });

  test('18: manage permite criação e transições completas', async () => {
    const followUp = await createFollowUp();

    const start = await app.inject({ method: 'POST', url: `/agents/follow-ups/${followUp.id}/start`, headers: authHeader(ceoToken) });
    assert.equal(start.statusCode, 200, start.body);
    assert.equal(start.json().data.status, 'in_progress');

    const wait = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUp.id}/wait`,
      headers: authHeader(ceoToken),
      payload: { waitingReason: 'Aguardando retorno.' },
    });
    assert.equal(wait.statusCode, 200, wait.body);
    assert.equal(wait.json().data.status, 'waiting');

    const resume = await app.inject({ method: 'POST', url: `/agents/follow-ups/${followUp.id}/resume`, headers: authHeader(ceoToken) });
    assert.equal(resume.statusCode, 200, resume.body);
    assert.equal(resume.json().data.status, 'in_progress');

    const complete = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUp.id}/complete`,
      headers: authHeader(ceoToken),
      payload: { resolution: 'Concluído via teste HTTP.' },
    });
    assert.equal(complete.statusCode, 200, complete.body);
    assert.equal(complete.json().data.status, 'completed');
  });

  test('13: transição inválida via HTTP → 409 (start de novo depois de completed)', async () => {
    const followUp = await createFollowUp();
    await app.inject({ method: 'POST', url: `/agents/follow-ups/${followUp.id}/complete`, headers: authHeader(ceoToken), payload: { resolution: 'x' } });

    const startAgain = await app.inject({ method: 'POST', url: `/agents/follow-ups/${followUp.id}/start`, headers: authHeader(ceoToken) });
    assert.equal(startAgain.statusCode, 409);
  });

  test('dismiss via HTTP exige reason', async () => {
    const followUp = await createFollowUp();

    const missingReason = await app.inject({ method: 'POST', url: `/agents/follow-ups/${followUp.id}/dismiss`, headers: authHeader(ceoToken), payload: {} });
    assert.equal(missingReason.statusCode, 400);

    const withReason = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUp.id}/dismiss`,
      headers: authHeader(ceoToken),
      payload: { reason: 'Não relevante.' },
    });
    assert.equal(withReason.statusCode, 200, withReason.body);
    assert.equal(withReason.json().data.status, 'dismissed');
  });

  test('reassign via HTTP: usuário inexistente rejeitado, usuário real aceito', async () => {
    const followUp = await createFollowUp();

    const invalid = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUp.id}/reassign`,
      headers: authHeader(ceoToken),
      payload: { assignedUserId: 999999999 },
    });
    assert.equal(invalid.statusCode, 400);

    const valid = await app.inject({
      method: 'POST',
      url: `/agents/follow-ups/${followUp.id}/reassign`,
      headers: authHeader(ceoToken),
      payload: { assignedUserId: ceoUserId },
    });
    assert.equal(valid.statusCode, 200, valid.body);
    assert.equal(valid.json().data.assignedUserId, ceoUserId);
  });

  test('payload com campo extra é rejeitado (.strict())', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/follow-ups',
      headers: authHeader(ceoToken),
      payload: { responsibilityId, title: 'x', priority: 'medium', campoInventado: 'nunca deveria passar' },
    });
    assert.equal(response.statusCode, 400);
  });

  test('id inválido → 400; follow-up inexistente → 404', async () => {
    const invalid = await app.inject({ method: 'GET', url: '/agents/follow-ups/not-a-number', headers: authHeader(ceoToken) });
    assert.equal(invalid.statusCode, 400);

    const missing = await app.inject({ method: 'GET', url: '/agents/follow-ups/999999999', headers: authHeader(ceoToken) });
    assert.equal(missing.statusCode, 404);
  });

  test('nenhum endpoint de PATCH genérico de status existe (404)', async () => {
    const followUp = await createFollowUp();
    const response = await app.inject({ method: 'PATCH', url: `/agents/follow-ups/${followUp.id}`, headers: authHeader(ceoToken), payload: { status: 'completed' } });
    assert.equal(response.statusCode, 404, 'não deveria existir uma rota PATCH que altere status livremente');
  });

  test('filtro por status/overdue funciona', async () => {
    const followUp = await createFollowUp();

    const response = await app.inject({ method: 'GET', url: '/agents/follow-ups?status=open', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    const { data } = response.json();
    assert.ok(data.some((item: { id: number }) => item.id === followUp.id));
    assert.ok(data.every((item: { status: string }) => item.status === 'open'));
  });
});
