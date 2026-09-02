import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, desc, eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentDirectorGoals, auditLogs, permissions, rolePermissions, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { registerAllTools } from '../../agents/tools/index.js';

/*
 * Agentes v2.0 (correio.md seção 23) — Director Goals API: criação,
 * permissions, transições de status, métricas (catálogo fechado),
 * filtros.
 */
describe('Agentes v2.0 - Director Goals API', () => {
  const app = buildApp();
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;

  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;

  const goalIds: number[] = [];

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
      .values({ name: `Teste Goals Read ${runId}`, slug: `test-goals-read-${runId}`, description: 'read only', isSystem: false })
      .returning();
    readOnlyRoleId = role.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: readPerm.id });

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-goals-read-${runId}@example.com`;
    const [user] = await db.insert(users).values({ name: 'Read Only', email, passwordHash, roleId: role.id, isActive: true }).returning();
    readOnlyUserId = user.id;
    readOnlyToken = await login(email, 'senha-teste-12345');
  });

  after(async () => {
    for (const id of goalIds) await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, id));
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));

    await database.end();
    redis.disconnect();
  });

  test('POST /director/goals: cria como draft; targetDate <= startDate é rejeitado (400)', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/agents/director/goals',
      headers: authHeader(ceoToken),
      payload: {
        title: `Goal Invalido ${runId}`,
        description: 'desc',
        domain: 'crm',
        startDate: '2026-06-01T00:00:00.000Z',
        targetDate: '2026-05-01T00:00:00.000Z',
      },
    });
    assert.equal(invalid.statusCode, 400);

    const response = await app.inject({
      method: 'POST',
      url: '/agents/director/goals',
      headers: authHeader(ceoToken),
      payload: {
        title: `Goal Válido ${runId}`,
        description: 'Conquistar novos clientes.',
        domain: 'crm',
        startDate: '2026-01-01T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
        targetType: 'metric',
      },
    });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.status, 'draft');
    goalIds.push(response.json().data.id);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'agents.director.goal.created'), eq(auditLogs.entityId, String(response.json().data.id))))
      .orderBy(desc(auditLogs.id))
      .limit(1);
    assert.ok(log);
  });

  test('read-only não consegue criar/mutar Goal (403), mas lê normalmente', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/agents/director/goals',
      headers: authHeader(readOnlyToken),
      payload: {
        title: 'x',
        description: 'x',
        domain: 'crm',
        startDate: '2026-01-01T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
      },
    });
    assert.equal(create.statusCode, 403);

    const list = await app.inject({ method: 'GET', url: '/agents/director/goals', headers: authHeader(readOnlyToken) });
    assert.equal(list.statusCode, 200);

    const overview = await app.inject({ method: 'GET', url: '/agents/director/goals/overview', headers: authHeader(readOnlyToken) });
    assert.equal(overview.statusCode, 200);
  });

  test('GET /director/goals/metrics/catalog expõe só o catálogo fechado', async () => {
    const response = await app.inject({ method: 'GET', url: '/agents/director/goals/metrics/catalog', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    const keys = response.json().data.map((entry: { key: string }) => entry.key);
    assert.ok(keys.includes('crm.clients_won'));
    assert.ok(keys.includes('finance.overdue_amount'));
  });

  test('ciclo de vida: draft -> activate -> pause -> activate -> cancel (com reason)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/director/goals',
      headers: authHeader(ceoToken),
      payload: {
        title: `Goal Ciclo ${runId}`,
        description: 'desc',
        domain: 'projects',
        startDate: '2026-01-01T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
        targetType: 'milestone',
      },
    });
    const goalId = created.json().data.id;
    goalIds.push(goalId);

    const activate = await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/activate`, headers: authHeader(ceoToken) });
    assert.equal(activate.statusCode, 200, activate.body);
    assert.equal(activate.json().data.status, 'active');

    // activate de novo (já active) -> 409.
    const activateAgain = await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/activate`, headers: authHeader(ceoToken) });
    assert.equal(activateAgain.statusCode, 409);

    const pause = await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/pause`, headers: authHeader(ceoToken) });
    assert.equal(pause.statusCode, 200);
    assert.equal(pause.json().data.status, 'paused');

    // pause de um Goal já pausado -> 409.
    const pauseAgain = await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/pause`, headers: authHeader(ceoToken) });
    assert.equal(pauseAgain.statusCode, 409);

    const reactivate = await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/activate`, headers: authHeader(ceoToken) });
    assert.equal(reactivate.statusCode, 200);

    const cancelNoReason = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/cancel`,
      headers: authHeader(ceoToken),
      payload: { reason: '' },
    });
    assert.equal(cancelNoReason.statusCode, 400);

    const cancel = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/cancel`,
      headers: authHeader(ceoToken),
      payload: { reason: 'Prioridade estratégica mudou.' },
    });
    assert.equal(cancel.statusCode, 200, cancel.body);
    assert.equal(cancel.json().data.status, 'cancelled');
    assert.equal(cancel.json().data.cancellationReason, 'Prioridade estratégica mudou.');

    const cancelAgain = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/cancel`,
      headers: authHeader(ceoToken),
      payload: { reason: 'segunda tentativa' },
    });
    assert.equal(cancelAgain.statusCode, 409);
  });

  test('métricas: chave fora do catálogo é rejeitada; chave válida é aceita; duplicata no mesmo Goal é rejeitada', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/director/goals',
      headers: authHeader(ceoToken),
      payload: {
        title: `Goal Métricas ${runId}`,
        description: 'desc',
        domain: 'crm',
        startDate: '2026-01-01T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
      },
    });
    const goalId = created.json().data.id;
    goalIds.push(goalId);

    const invalidKey = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/metrics`,
      headers: authHeader(ceoToken),
      payload: { metricKey: 'sql.arbitrary.query', targetValue: 20, weight: 1 },
    });
    assert.equal(invalidKey.statusCode, 400, invalidKey.body);

    const valid = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/metrics`,
      headers: authHeader(ceoToken),
      payload: { metricKey: 'crm.clients_won', targetValue: 20, weight: 1 },
    });
    assert.equal(valid.statusCode, 201, valid.body);
    assert.equal(valid.json().data.metricKey, 'crm.clients_won');

    const duplicate = await app.inject({
      method: 'POST',
      url: `/agents/director/goals/${goalId}/metrics`,
      headers: authHeader(ceoToken),
      payload: { metricKey: 'crm.clients_won', targetValue: 30, weight: 1 },
    });
    assert.equal(duplicate.statusCode, 409, duplicate.body);
  });

  test('POST /director/goals/:id/evaluate: calcula progress/health e devolve no detalhe do Goal (com histórico)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/director/goals',
      headers: authHeader(ceoToken),
      payload: {
        title: `Goal Evaluate ${runId}`,
        description: 'desc',
        domain: 'crm',
        startDate: '2026-01-01T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
        targetType: 'milestone',
      },
    });
    const goalId = created.json().data.id;
    goalIds.push(goalId);
    await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/activate`, headers: authHeader(ceoToken) });

    const evaluate = await app.inject({ method: 'POST', url: `/agents/director/goals/${goalId}/evaluate`, headers: authHeader(ceoToken) });
    assert.equal(evaluate.statusCode, 200, evaluate.body);
    assert.ok(['on_track', 'attention', 'at_risk', 'critical'].includes(evaluate.json().data.goal.health));

    const detail = await app.inject({ method: 'GET', url: `/agents/director/goals/${goalId}`, headers: authHeader(ceoToken) });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().data.evaluations.length, 1);
  });

  test('evaluate de Goal inexistente → 404', async () => {
    const response = await app.inject({ method: 'POST', url: '/agents/director/goals/999999999/evaluate', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 404);
  });

  test('filtro por domain retorna só Goals daquele domínio', async () => {
    const response = await app.inject({ method: 'GET', url: '/agents/director/goals?domain=crm&limit=100', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().data.every((goal: { domain: string }) => goal.domain === 'crm'));
  });
});
