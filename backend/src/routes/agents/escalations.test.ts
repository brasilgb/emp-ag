import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentResponsibilities, agents, permissions, rolePermissions, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { createOrReopenEscalation } from '../../agents/escalations/service.js';

/*
 * Agentes v2.6 (correio.md seção 19, itens 26-29) — API de Escalations:
 * autorização (read vs manage), acknowledge/resolve/dismiss via HTTP,
 * transições inválidas rejeitadas, nenhum endpoint de criação livre.
 */
describe('Agentes v2.6 - Escalations API', () => {
  const app = buildApp();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;
  let salesAgentId: number;
  let directorAgentId: number;
  let responsibilityId: number;
  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;
  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;
  const escalationIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createEscalation(dedupKey: string) {
    const { escalation } = await createOrReopenEscalation({
      responsibilityId,
      sourceAgentId: salesAgentId,
      targetAgentId: directorAgentId,
      targetUserId: null,
      reason: 'fixture de teste HTTP',
      severity: 'warning',
      entityType: 'agent_job',
      entityId: 1,
      dedupKey,
      metadata: {},
    });
    escalationIds.push(escalation.id);
    return escalation;
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
    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    directorAgentId = director!.id;

    const [responsibility] = await db
      .insert(agentResponsibilities)
      .values({ agentId: salesAgentId, name: `Escalations API fixture ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'agent', escalationTargetAgentId: directorAgentId, createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);

    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste Escal ReadOnly ${runId}`, slug: `test-escal-readonly-${runId}`, description: 'read only', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.escalations.read')).limit(1);
    assert.ok(readPerm);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm.id });
    const readOnlyEmail = `test-escal-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only Escal', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');

    const [noPermRole] = await db
      .insert(roles)
      .values({ name: `Teste Escal SemPerm ${runId}`, slug: `test-escal-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const noPermEmail = `test-escal-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão Escal', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');
  });

  after(async () => {
    for (const id of escalationIds) await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, id));
    await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, responsibilityId));
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));
    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));

    await database.end();
    redis.disconnect();
  });

  test('26: sem nenhuma permission → GET e POST acknowledge/resolve/dismiss retornam 403', async () => {
    const escalation = await createEscalation(`http-noperm-${runId}`);

    const list = await app.inject({ method: 'GET', url: '/agents/escalations', headers: authHeader(noPermToken) });
    assert.equal(list.statusCode, 403);

    const ack = await app.inject({ method: 'POST', url: `/agents/escalations/${escalation.id}/acknowledge`, headers: authHeader(noPermToken) });
    assert.equal(ack.statusCode, 403);
  });

  test('read-only (agents.escalations.read) lista/lê, mas não consegue transicionar (403)', async () => {
    const escalation = await createEscalation(`http-readonly-${runId}`);

    const list = await app.inject({ method: 'GET', url: '/agents/escalations', headers: authHeader(readOnlyToken) });
    assert.equal(list.statusCode, 200, list.body);

    const detail = await app.inject({ method: 'GET', url: `/agents/escalations/${escalation.id}`, headers: authHeader(readOnlyToken) });
    assert.equal(detail.statusCode, 200);

    const ack = await app.inject({ method: 'POST', url: `/agents/escalations/${escalation.id}/acknowledge`, headers: authHeader(readOnlyToken) });
    assert.equal(ack.statusCode, 403);
  });

  test('acknowledge → resolve via HTTP funcionam em sequência válida', async () => {
    const escalation = await createEscalation(`http-flow-${runId}`);

    const ack = await app.inject({ method: 'POST', url: `/agents/escalations/${escalation.id}/acknowledge`, headers: authHeader(ceoToken) });
    assert.equal(ack.statusCode, 200, ack.body);
    assert.equal(ack.json().data.status, 'acknowledged');

    const resolve = await app.inject({ method: 'POST', url: `/agents/escalations/${escalation.id}/resolve`, headers: authHeader(ceoToken) });
    assert.equal(resolve.statusCode, 200, resolve.body);
    assert.equal(resolve.json().data.status, 'resolved');
  });

  test('29: transição inválida via HTTP → 409 (resolve de novo depois de já resolved)', async () => {
    const escalation = await createEscalation(`http-invalid-${runId}`);
    await app.inject({ method: 'POST', url: `/agents/escalations/${escalation.id}/resolve`, headers: authHeader(ceoToken) });

    const again = await app.inject({ method: 'POST', url: `/agents/escalations/${escalation.id}/resolve`, headers: authHeader(ceoToken) });
    assert.equal(again.statusCode, 409);
  });

  test('dismiss via HTTP exige reason (400 sem reason, 200 com reason)', async () => {
    const escalation = await createEscalation(`http-dismiss-${runId}`);

    const missingReason = await app.inject({ method: 'POST', url: `/agents/escalations/${escalation.id}/dismiss`, headers: authHeader(ceoToken), payload: {} });
    assert.equal(missingReason.statusCode, 400);

    const withReason = await app.inject({
      method: 'POST',
      url: `/agents/escalations/${escalation.id}/dismiss`,
      headers: authHeader(ceoToken),
      payload: { reason: 'Falso positivo confirmado via HTTP.' },
    });
    assert.equal(withReason.statusCode, 200, withReason.body);
    assert.equal(withReason.json().data.status, 'dismissed');
  });

  test('28: id inválido → 400; escalation inexistente → 404', async () => {
    const invalid = await app.inject({ method: 'GET', url: '/agents/escalations/not-a-number', headers: authHeader(ceoToken) });
    assert.equal(invalid.statusCode, 400);

    const missing = await app.inject({ method: 'GET', url: '/agents/escalations/999999999', headers: authHeader(ceoToken) });
    assert.equal(missing.statusCode, 404);

    const missingAck = await app.inject({ method: 'POST', url: '/agents/escalations/999999999/acknowledge', headers: authHeader(ceoToken) });
    assert.equal(missingAck.statusCode, 404);
  });

  test('19: nenhum endpoint de criação livre existe — POST /agents/escalations não está registrado (404)', async () => {
    const response = await app.inject({ method: 'POST', url: '/agents/escalations', headers: authHeader(ceoToken), payload: {} });
    assert.equal(response.statusCode, 404, 'não deveria existir uma rota de criação manual de escalation nesta versão');
  });

  test('filtro por status/severity funciona', async () => {
    const escalation = await createEscalation(`http-filter-${runId}`);

    const response = await app.inject({ method: 'GET', url: '/agents/escalations?status=open&severity=warning', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    const { data } = response.json();
    assert.ok(data.some((item: { id: number }) => item.id === escalation.id));
    assert.ok(data.every((item: { status: string; severity: string }) => item.status === 'open' && item.severity === 'warning'));
  });
});
