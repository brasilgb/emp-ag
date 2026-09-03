import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentDirectorGoals, agentDirectorInitiatives, agentExecutiveReviews, permissions, rolePermissions, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

const HOUR_MS = 60 * 60 * 1000;

/*
 * Agentes v2.5 (correio.md seção 28, "API/Auth") — GET /operations/health,
 * GET /operations/incidents, POST /operations/supervise: autorização
 * (agents.operations.read vs agents.operations.manage), dry-run real.
 */
describe('Agentes v2.5 - Operations Supervisor API', () => {
  const app = buildApp();
  const runId = Date.now() % 1_000_000;

  let ceoToken: string;
  let ceoUserId: number;
  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;
  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;
  let goalId: number;
  const reviewIds: number[] = [];
  const initiativeIds: number[] = [];
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
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [noPermRole] = await db
      .insert(roles)
      .values({ name: `Teste Ops SemPerm ${runId}`, slug: `test-ops-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const noPermEmail = `test-ops-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão Ops', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');

    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste Ops ReadOnly ${runId}`, slug: `test-ops-readonly-${runId}`, description: 'só operations.read', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.operations.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm!.id });
    const readOnlyEmail = `test-ops-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only Ops', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({ title: `Goal Ops API ${runId}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', createdBy: ceoUserId, startDate: new Date('2026-01-01T00:00:00.000Z'), targetDate: new Date('2026-12-01T00:00:00.000Z'), targetType: 'milestone' })
      .returning();
    goalId = goal!.id;
  });

  after(async () => {
    for (const id of reviewIds) await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, id));
    for (const id of initiativeIds) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    for (const id of planIds) {
      const { agentActionPlans } = await import('../../db/schema/index.js');
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, id));
    }
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));

    await database.end();
    redis.disconnect();
  });

  async function insertStaleReview() {
    const { agentActionPlans } = await import('../../db/schema/index.js');
    const [plan] = await db.insert(agentActionPlans).values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'completed' }).returning();
    planIds.push(plan!.id);
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId, title: `Initiative Ops API ${runId}-${Math.random()}`, description: 'd', domain: 'crm', status: 'completed', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId, actionPlanId: plan!.id })
      .returning();
    initiativeIds.push(initiative!.id);
    const old = new Date(Date.now() - HOUR_MS);
    const [review] = await db
      .insert(agentExecutiveReviews)
      .values({ goalId, initiativeId: initiative!.id, actionPlanId: plan!.id, createdBy: ceoUserId, reviewType: 'initiative_outcome', status: 'draft', evidence: {}, updatedAt: old })
      .returning();
    reviewIds.push(review!.id);
    return review!;
  }

  test('30/32: sem nenhuma permission → GET /operations/health 403, POST /operations/supervise 403', async () => {
    const health = await app.inject({ method: 'GET', url: '/agents/operations/health', headers: authHeader(noPermToken) });
    assert.equal(health.statusCode, 403);

    const supervise = await app.inject({ method: 'POST', url: '/agents/operations/supervise', headers: authHeader(noPermToken) });
    assert.equal(supervise.statusCode, 403);
  });

  test('31: leitura com agents.operations.read → 200; execução continua 403', async () => {
    const health = await app.inject({ method: 'GET', url: '/agents/operations/health', headers: authHeader(readOnlyToken) });
    assert.equal(health.statusCode, 200, health.body);

    const incidents = await app.inject({ method: 'GET', url: '/agents/operations/incidents', headers: authHeader(readOnlyToken) });
    assert.equal(incidents.statusCode, 200, incidents.body);

    const supervise = await app.inject({ method: 'POST', url: '/agents/operations/supervise', headers: authHeader(readOnlyToken) });
    assert.equal(supervise.statusCode, 403, 'leitura não deveria autorizar execução da supervisão');
  });

  test('33: dry-run autorizado → 200, sem alterar o banco', async () => {
    const review = await insertStaleReview();

    const response = await app.inject({ method: 'POST', url: '/agents/operations/supervise?dryRun=true', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.dryRun, true);

    const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.ok(reloaded, 'dry-run via HTTP nunca deveria alterar o banco');
    assert.equal(reloaded!.status, 'draft');
  });

  test('34: execução real autorizada → 200, reconcilia de verdade', async () => {
    const review = await insertStaleReview();

    const response = await app.inject({ method: 'POST', url: '/agents/operations/supervise', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.dryRun, false);

    const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.equal(reloaded, undefined, 'execução real deveria ter reconciliado a review draft órfã');
  });

  test('GET /operations/health devolve um status estruturado válido', async () => {
    const response = await app.inject({ method: 'GET', url: '/agents/operations/health', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    const health = response.json().data;
    assert.ok(['healthy', 'degraded', 'attention_required', 'restricted'].includes(health.status));
    assert.ok(typeof health.summary.activeIncidents === 'number');
    assert.ok(Array.isArray(health.incidents));
    assert.ok(Array.isArray(health.recommendations));
  });
});
