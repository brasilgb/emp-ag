import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutiveReviews,
  agentStrategicMemories,
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

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

function memoryOutput() {
  return { title: 'Título HTTP', summary: 'Resumo HTTP', lesson: 'Lição HTTP', confidence: 0.8, importance: 'medium', tags: ['http'] };
}

/*
 * Agentes v2.3 (correio.md seção 17/18/23 itens 17/18) — Strategic
 * Memory API: autorização (read vs manage), fluxo completo via HTTP
 * (POST .../memory idempotente, GET lista/detalhe).
 */
describe('Agentes v2.3 - Director Memories API', () => {
  const app = buildApp();
  registerAllTools();
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

    // Usuário sem NENHUMA permission de Diretor (nem read, nem manage).
    const [noPermRole] = await db
      .insert(roles)
      .values({ name: `Teste Memory SemPerm ${runId}`, slug: `test-memory-noperm-${runId}`, description: 'sem permissions', isSystem: false })
      .returning();
    noPermRoleId = noPermRole!.id;
    const [dummyPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: noPermRoleId, permissionId: dummyPerm!.id });
    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const noPermEmail = `test-memory-noperm-${runId}@example.com`;
    const [noPermUser] = await db.insert(users).values({ name: 'Sem Permissão Memory', email: noPermEmail, passwordHash, roleId: noPermRoleId, isActive: true }).returning();
    noPermUserId = noPermUser!.id;
    noPermToken = await login(noPermEmail, 'senha-teste-12345');

    // Usuário só com agents.read (pode ler, não pode gerar memória).
    const [readOnlyRole] = await db
      .insert(roles)
      .values({ name: `Teste Memory ReadOnly ${runId}`, slug: `test-memory-readonly-${runId}`, description: 'só agents.read', isSystem: false })
      .returning();
    readOnlyRoleId = readOnlyRole!.id;
    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.read')).limit(1);
    await db.insert(rolePermissions).values({ roleId: readOnlyRoleId, permissionId: readPerm!.id });
    const readOnlyEmail = `test-memory-readonly-${runId}@example.com`;
    const [readOnlyUser] = await db.insert(users).values({ name: 'Read Only Memory', email: readOnlyEmail, passwordHash, roleId: readOnlyRoleId, isActive: true }).returning();
    readOnlyUserId = readOnlyUser!.id;
    readOnlyToken = await login(readOnlyEmail, 'senha-teste-12345');

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal p/ Memory API ${runId}`,
        description: 'desc',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        createdBy: ceoUserId,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
        targetType: 'milestone',
      })
      .returning();
    goalId = goal!.id;

    process.env.AGENT_LLM_ENABLED = 'true';
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;

    await db.delete(users).where(eq(users.id, noPermUserId));
    await db.delete(roles).where(eq(roles.id, noPermRoleId));
    await db.delete(users).where(eq(users.id, readOnlyUserId));
    await db.delete(roles).where(eq(roles.id, readOnlyRoleId));
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  async function insertCompletedReview() {
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({
        goalId,
        title: `Initiative Memory API ${runId}-${Math.random()}`,
        description: 'desc',
        domain: 'crm',
        status: 'completed',
        priority: 'medium',
        rationale: 'r',
        origin: 'manual',
        createdBy: ceoUserId,
      })
      .returning();

    const { agentActionPlans } = await import('../../db/schema/index.js');
    const [plan] = await db.insert(agentActionPlans).values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'completed' }).returning();
    await db.update(agentDirectorInitiatives).set({ actionPlanId: plan!.id }).where(eq(agentDirectorInitiatives.id, initiative!.id));

    const [review] = await db
      .insert(agentExecutiveReviews)
      .values({
        goalId,
        initiativeId: initiative!.id,
        actionPlanId: plan!.id,
        createdBy: ceoUserId,
        reviewType: 'initiative_outcome',
        status: 'completed',
        outcome: 'successful',
        confidence: '0.900',
        recommendationType: 'none',
        recommendation: { type: 'none', reason: 'ok' },
        evidence: {},
      })
      .returning();

    return { review: review!, initiativeId: initiative!.id, planId: plan!.id };
  }

  test('17: sem nenhuma permission de Diretor → POST .../memory 403, nenhuma memória criada', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview();
    try {
      const response = await app.inject({ method: 'POST', url: `/agents/director/reviews/${review.id}/memory`, headers: authHeader(noPermToken) });
      assert.equal(response.statusCode, 403);

      const rows = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, review.id));
      assert.equal(rows.length, 0);
    } finally {
      await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId));
      const { agentActionPlans } = await import('../../db/schema/index.js');
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, planId));
    }
  });

  test('18: só agents.read → GET /director/memories 200, mas POST .../memory continua 403', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview();
    try {
      const list = await app.inject({ method: 'GET', url: '/agents/director/memories', headers: authHeader(readOnlyToken) });
      assert.equal(list.statusCode, 200, list.body);

      const post = await app.inject({ method: 'POST', url: `/agents/director/reviews/${review.id}/memory`, headers: authHeader(readOnlyToken) });
      assert.equal(post.statusCode, 403);

      const listNoPerm = await app.inject({ method: 'GET', url: '/agents/director/memories', headers: authHeader(noPermToken) });
      assert.equal(listNoPerm.statusCode, 403, 'usuário sem agents.read não deveria conseguir listar memórias');
    } finally {
      await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId));
      const { agentActionPlans } = await import('../../db/schema/index.js');
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, planId));
    }
  });

  test('fluxo completo via HTTP: POST .../memory (201) → GET detalhe → GET lista filtrada por goalId → segunda POST idempotente (200)', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview();
    try {
      setLLMProviderOverrideForTests(mockProvider(memoryOutput()));

      const create = await app.inject({ method: 'POST', url: `/agents/director/reviews/${review.id}/memory`, headers: authHeader(ceoToken) });
      assert.equal(create.statusCode, 201, create.body);
      const memoryId = create.json().data.id;
      assert.equal(create.json().data.status, 'active');
      assert.equal(create.json().data.sourceReviewId, review.id);

      const detail = await app.inject({ method: 'GET', url: `/agents/director/memories/${memoryId}`, headers: authHeader(ceoToken) });
      assert.equal(detail.statusCode, 200, detail.body);
      assert.equal(detail.json().data.id, memoryId);

      const list = await app.inject({ method: 'GET', url: `/agents/director/memories?goalId=${goalId}`, headers: authHeader(ceoToken) });
      assert.equal(list.statusCode, 200);
      assert.ok(list.json().data.some((memory: { id: number }) => memory.id === memoryId));

      const createAgain = await app.inject({ method: 'POST', url: `/agents/director/reviews/${review.id}/memory`, headers: authHeader(ceoToken) });
      assert.equal(createAgain.statusCode, 200, 'chamada idempotente devolve a mesma memória, nunca 201 de novo');
      assert.equal(createAgain.json().data.id, memoryId);

      await db.delete(agentStrategicMemories).where(eq(agentStrategicMemories.id, memoryId));
    } finally {
      await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId));
      const { agentActionPlans } = await import('../../db/schema/index.js');
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, planId));
    }
  });

  test('review inexistente → POST .../memory 404', async () => {
    const response = await app.inject({ method: 'POST', url: '/agents/director/reviews/999999999/memory', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 404);
  });
});
