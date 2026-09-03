import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { permissions, rolePermissions, roles, settings, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { OPERATIONAL_SUPERVISION_SETTING_KEY } from '../../agents/operations/scheduler-settings.js';

/*
 * Agentes v2.5.1 (correio.md seção 34, "config" itens 22/23 + seção 33
 * item 11 via HTTP) — GET/PATCH /operations/scheduler: autorização,
 * validação do body, e 409 quando uma supervisão manual é solicitada
 * enquanto outra já está em andamento (guard central, mesmo path de
 * `POST /operations/supervise`).
 */
describe('Agentes v2.5.1 - Operational Supervision Scheduler API', () => {
  const app = buildApp();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;
  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;

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

    const [noPermRole] = await db
      .insert(roles)
      .values({ name: `Teste SchedOps SemPerm ${runId}`, slug: `test-schedops-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const noPermEmail = `test-schedops-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão SchedOps', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');

    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste SchedOps ReadOnly ${runId}`, slug: `test-schedops-readonly-${runId}`, description: 'só operations.read', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.operations.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm!.id });
    const readOnlyEmail = `test-schedops-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only SchedOps', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');
  });

  after(async () => {
    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));
    await db.delete(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY));

    await database.end();
    redis.disconnect();
  });

  test('sem nenhuma permission → GET /operations/scheduler 403, PATCH 403', async () => {
    const get = await app.inject({ method: 'GET', url: '/agents/operations/scheduler', headers: authHeader(noPermToken) });
    assert.equal(get.statusCode, 403);

    const patch = await app.inject({ method: 'PATCH', url: '/agents/operations/scheduler', headers: authHeader(noPermToken), payload: { enabled: true } });
    assert.equal(patch.statusCode, 403);
  });

  test('22/23: agents.operations.read → GET 200; PATCH continua exigindo agents.operations.manage (403)', async () => {
    const get = await app.inject({ method: 'GET', url: '/agents/operations/scheduler', headers: authHeader(readOnlyToken) });
    assert.equal(get.statusCode, 200, get.body);

    const patch = await app.inject({ method: 'PATCH', url: '/agents/operations/scheduler', headers: authHeader(readOnlyToken), payload: { enabled: true } });
    assert.equal(patch.statusCode, 403);
  });

  test('PATCH com agents.operations.manage liga/desliga de verdade, auditado', async () => {
    const enable = await app.inject({ method: 'PATCH', url: '/agents/operations/scheduler', headers: authHeader(ceoToken), payload: { enabled: true } });
    assert.equal(enable.statusCode, 200, enable.body);
    assert.equal(enable.json().data.enabled, true);

    const disable = await app.inject({ method: 'PATCH', url: '/agents/operations/scheduler', headers: authHeader(ceoToken), payload: { enabled: false } });
    assert.equal(disable.statusCode, 200);
    assert.equal(disable.json().data.enabled, false);
  });

  test('PATCH com campo extra ("command") é rejeitado — 400, nunca aceita instrução livre', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/agents/operations/scheduler',
      headers: authHeader(ceoToken),
      payload: { enabled: true, command: 'execute anything' },
    });
    assert.equal(response.statusCode, 400);
  });

  test('PATCH com intervalSeconds é rejeitado — 400 (só "enabled" é aceito nesta versão)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/agents/operations/scheduler',
      headers: authHeader(ceoToken),
      payload: { enabled: true, intervalSeconds: 60 },
    });
    assert.equal(response.statusCode, 400);
  });

  test('PATCH com "enabled" não-booleano é rejeitado — 400, setting não é alterado', async () => {
    const before = await app.inject({ method: 'GET', url: '/agents/operations/scheduler', headers: authHeader(ceoToken) });
    const beforeEnabled = before.json().data.enabled;

    const response = await app.inject({ method: 'PATCH', url: '/agents/operations/scheduler', headers: authHeader(ceoToken), payload: { enabled: 'yes' } });
    assert.equal(response.statusCode, 400);

    const after = await app.inject({ method: 'GET', url: '/agents/operations/scheduler', headers: authHeader(ceoToken) });
    assert.equal(after.json().data.enabled, beforeEnabled, 'valor inválido não deveria ter alterado o setting');
  });

  test('11: POST /operations/supervise concorrente enquanto outro já está em andamento → 409 Conflict', async () => {
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/agents/operations/supervise?dryRun=true', headers: authHeader(ceoToken) }),
      app.inject({ method: 'POST', url: '/agents/operations/supervise?dryRun=true', headers: authHeader(ceoToken) }),
    ]);

    const statusCodes = [first.statusCode, second.statusCode].sort();
    assert.deepEqual(statusCodes, [200, 409], 'uma das duas chamadas concorrentes deveria ter sido rejeitada com 409');

    const conflictResponse = first.statusCode === 409 ? first : second;
    assert.equal(conflictResponse.json().error, 'conflict');
  });
});
