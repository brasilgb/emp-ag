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
 * Agentes v2.4 (correio.md seção 24, itens 21 + observabilidade) — API
 * de recovery via HTTP: autorização (agents.recovery.manage vs
 * agents.operations.read), dry-run real via query string, fluxo
 * completo.
 */
describe('Agentes v2.4 - Recovery API', () => {
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
      .values({ name: `Teste Recovery SemPerm ${runId}`, slug: `test-recovery-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const noPermEmail = `test-recovery-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão Recovery', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');

    // Só agents.operations.read (leitura), sem agents.recovery.manage.
    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste Recovery ReadOnly ${runId}`, slug: `test-recovery-readonly-${runId}`, description: 'só operations.read', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.operations.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm!.id });
    const readOnlyEmail = `test-recovery-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only Recovery', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({ title: `Goal p/ Recovery API ${runId}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', createdBy: ceoUserId, startDate: new Date('2026-01-01T00:00:00.000Z'), targetDate: new Date('2026-12-01T00:00:00.000Z'), targetType: 'milestone' })
      .returning();
    goalId = goal!.id;
  });

  after(async () => {
    for (const id of reviewIds) await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, id));
    for (const id of initiativeIds) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    for (const id of planIds) {
      const { agentActionPlans, agentActionPlanItems } = await import('../../db/schema/index.js');
      await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, id));
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
    const old = new Date(Date.now() - HOUR_MS);
    const { agentActionPlans } = await import('../../db/schema/index.js');
    const [plan] = await db.insert(agentActionPlans).values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'completed' }).returning();
    planIds.push(plan!.id);
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId, title: `Recovery API ${runId}-${Math.random()}`, description: 'd', domain: 'crm', status: 'completed', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId, actionPlanId: plan!.id })
      .returning();
    initiativeIds.push(initiative!.id);
    const [review] = await db
      .insert(agentExecutiveReviews)
      .values({ goalId, initiativeId: initiative!.id, actionPlanId: plan!.id, createdBy: ceoUserId, reviewType: 'initiative_outcome', status: 'draft', evidence: {}, updatedAt: old })
      .returning();
    reviewIds.push(review!.id);
    return review!;
  }

  test('21: sem nenhuma permission → GET /recovery/status 403, POST /recovery/run 403', async () => {
    const status = await app.inject({ method: 'GET', url: '/agents/recovery/status', headers: authHeader(noPermToken) });
    assert.equal(status.statusCode, 403);

    const run = await app.inject({ method: 'POST', url: '/agents/recovery/run', headers: authHeader(noPermToken) });
    assert.equal(run.statusCode, 403);
  });

  test('só agents.operations.read → GET /status e /stale OK, mas POST /run continua 403', async () => {
    const status = await app.inject({ method: 'GET', url: '/agents/recovery/status', headers: authHeader(readOnlyToken) });
    assert.equal(status.statusCode, 200, status.body);

    const stale = await app.inject({ method: 'GET', url: '/agents/recovery/stale', headers: authHeader(readOnlyToken) });
    assert.equal(stale.statusCode, 200, stale.body);

    const run = await app.inject({ method: 'POST', url: '/agents/recovery/run', headers: authHeader(readOnlyToken) });
    assert.equal(run.statusCode, 403, 'leitura não deveria autorizar execução de reconciliação');
  });

  test('GET /recovery/stale?thresholdSeconds=60 lista o item stale recém-criado', async () => {
    const review = await insertStaleReview();

    const response = await app.inject({ method: 'GET', url: '/agents/recovery/stale?thresholdSeconds=60', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().data.some((item: { workflowType: string; entityId: number }) => item.workflowType === 'executive_review' && item.entityId === review.id));
  });

  test('POST /recovery/run?dryRun=true não altera o banco; POST /recovery/run (real) reconcilia de verdade', async () => {
    const review = await insertStaleReview();

    const dryRun = await app.inject({ method: 'POST', url: '/agents/recovery/run?dryRun=true&thresholdSeconds=60', headers: authHeader(ceoToken) });
    assert.equal(dryRun.statusCode, 200, dryRun.body);
    assert.equal(dryRun.json().data.dryRun, true);
    assert.ok(dryRun.json().data.items.some((item: { entityId: number; result: string }) => item.entityId === review.id && item.result === 'reverted'));

    const [stillDraft] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.ok(stillDraft, 'dry-run via HTTP nunca deveria ter alterado o banco');
    assert.equal(stillDraft!.status, 'draft');

    const real = await app.inject({ method: 'POST', url: '/agents/recovery/run?thresholdSeconds=60', headers: authHeader(ceoToken) });
    assert.equal(real.statusCode, 200, real.body);
    assert.equal(real.json().data.dryRun, false);

    const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.equal(reloaded, undefined, 'reconciliação real deveria ter removido a linha draft órfã');
  });

  test('POST /recovery/:type/:id reconcilia um item específico', async () => {
    const review = await insertStaleReview();

    const response = await app.inject({ method: 'POST', url: `/agents/recovery/executive_review/${review.id}?thresholdSeconds=60`, headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.result, 'reverted');

    const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.equal(reloaded, undefined);
  });

  test('POST /recovery/:type/:id para entidade que não está stale → 404', async () => {
    const response = await app.inject({ method: 'POST', url: '/agents/recovery/executive_review/999999999?thresholdSeconds=60', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 404);
  });

  test('type inválido no param → 400', async () => {
    const response = await app.inject({ method: 'POST', url: '/agents/recovery/not_a_real_type/1', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 400);
  });
});
