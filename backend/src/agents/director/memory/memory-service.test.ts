import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutiveReviews,
  agentStrategicMemories,
  agentTools,
  agents,
  users,
} from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../llm/factory.js';
import { registerAllTools } from '../../tools/index.js';
import type { LLMProvider, LLMResponse } from '../../llm/types.js';
import { AgentError } from '../../errors.js';

import { archiveStrategicMemory, createStrategicMemoryFromReview, listStrategicMemories } from './memory-service.js';
import type { ExecutiveReviewRow } from './memory-service.js';

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

function delayedProvider(rawResponse: unknown, delayMs: number): LLMProvider {
  return {
    name: 'mock-delayed',
    async complete(): Promise<LLMResponse> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { raw: rawResponse };
    },
  };
}

function failingProvider(message: string): LLMProvider {
  return {
    name: 'mock-failing',
    async complete(): Promise<LLMResponse> {
      throw new Error(message);
    },
  };
}

function memoryOutput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Título de teste',
    summary: 'Resumo de teste.',
    lesson: 'Lição de teste, generalizável para casos semelhantes.',
    confidence: 0.85,
    importance: 'medium',
    tags: ['teste', 'crm'],
    ...overrides,
  };
}

/*
 * Agentes v2.3 (correio.md seção 23) — Strategic Memory: cobre criação a
 * partir de Executive Review, provenance, separação evidência/
 * interpretação, idempotência/concorrência, ausência de lock durante o
 * LLM, falha do provider com retry seguro, e as garantias negativas
 * (nunca altera Goal/Initiative, nunca cria Action Plan/approval, nunca
 * executa tool).
 */
describe('Agentes v2.3 - Strategic Memory (memory-service)', () => {
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let goalId: number;
  let salesAgentId: number;
  let salesToolId: number;

  async function insertGoal(): Promise<number> {
    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal p/ Memory ${runId}-${Math.random()}`,
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
    return goal!.id;
  }

  async function insertInitiative(goal: number) {
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({
        goalId: goal,
        title: `Initiative Memory ${runId}-${Math.random()}`,
        description: 'desc',
        domain: 'crm',
        status: 'completed',
        priority: 'medium',
        rationale: 'racional',
        origin: 'manual',
        createdBy: ceoUserId,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .returning();
    return initiative!;
  }

  async function insertControlledPlan(itemStatuses: string[]): Promise<number> {
    const [plan] = await db
      .insert(agentActionPlans)
      .values({ requestedBy: ceoUserId, objective: 'Objetivo de teste controlado.', summary: 'Resumo de teste.', status: 'executing' })
      .returning();

    for (const [index, executionStatus] of itemStatuses.entries()) {
      await db.insert(agentActionPlanItems).values({
        planId: plan!.id,
        sequence: index,
        actionId: `action-${index}`,
        agent: 'sales',
        agentId: salesAgentId,
        tool: 'sales.get_pipeline_summary',
        toolId: salesToolId,
        arguments: {},
        risk: 'read',
        decision: 'execute',
        executionStatus,
        result: executionStatus === 'completed' ? { ok: true } : null,
      });
    }

    return plan!.id;
  }

  async function insertCompletedReview(goal: number): Promise<{ review: ExecutiveReviewRow; initiativeId: number; planId: number }> {
    const initiative = await insertInitiative(goal);
    const planId = await insertControlledPlan(['completed', 'completed']);
    await db.update(agentDirectorInitiatives).set({ actionPlanId: planId }).where(eq(agentDirectorInitiatives.id, initiative.id));

    const [review] = await db
      .insert(agentExecutiveReviews)
      .values({
        goalId: goal,
        initiativeId: initiative.id,
        actionPlanId: planId,
        createdBy: ceoUserId,
        reviewType: 'initiative_outcome',
        status: 'completed',
        outcome: 'successful',
        summary: 'Resumo da review.',
        assessment: 'Avaliação da review.',
        expectedResult: 'Esperado.',
        actualResult: 'Real.',
        confidence: '0.900',
        recommendationType: 'none',
        recommendation: { type: 'none', reason: 'ok' },
        evidence: {},
      })
      .returning();

    return { review: review!, initiativeId: initiative.id, planId };
  }

  async function cleanup(initiativeId: number, planId: number, reviewId: number) {
    await db.delete(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, reviewId));
    await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, reviewId));
    await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId));
    await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, planId));
    await db.delete(agentActionPlans).where(eq(agentActionPlans.id, planId));
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [sale] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, 'sales')).limit(1);
    const [tool] = await db.select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
    assert.ok(sale && tool);
    salesAgentId = sale.id;
    salesToolId = tool.id;

    process.env.AGENT_LLM_ENABLED = 'true';
    goalId = await insertGoal();
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;

    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));
    await database.end();
    redis.disconnect();
  });

  test('review não completed → rejeitado (409), nenhuma memória criada', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      const draftReview = { ...review, status: 'draft' as const };
      await assert.rejects(
        () => createStrategicMemoryFromReview(draftReview, ceoUserId),
        (error: unknown) => error instanceof AgentError && error.code === 'conflict',
      );
      const rows = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, review.id));
      assert.equal(rows.length, 0);
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('1/2/3: Executive Review gera memória válida com provenance real, evidência separada do lesson', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      setLLMProviderOverrideForTests(mockProvider(memoryOutput({ lesson: 'Interpretação do LLM, nunca fato bruto.' })));
      const { memory, created } = await createStrategicMemoryFromReview(review, ceoUserId);

      assert.equal(created, true);
      assert.equal(memory.status, 'active');
      assert.equal(memory.memoryType, 'initiative_outcome');
      assert.equal(memory.domain, 'crm');

      // Provenance real (seção 3) — nunca inventada pelo LLM.
      assert.equal(memory.sourceGoalId, goalId);
      assert.equal(memory.sourceInitiativeId, initiativeId);
      assert.equal(memory.sourceReviewId, review.id);

      // Evidência (fato, backend) separada de lesson (interpretação, LLM).
      const evidence = memory.evidence as { review: { outcome: string } };
      assert.equal(evidence.review.outcome, 'successful', 'evidência é o outcome REAL da review, nunca inventado');
      assert.equal(memory.lesson, 'Interpretação do LLM, nunca fato bruto.');
      assert.notEqual(memory.lesson, JSON.stringify(memory.evidence), 'lesson e evidence nunca são o mesmo campo/dado');
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('8/9: memória nunca altera Goal nem Initiative originais', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      const [goalBefore] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));
      const [initiativeBefore] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId));

      setLLMProviderOverrideForTests(mockProvider(memoryOutput()));
      await createStrategicMemoryFromReview(review, ceoUserId);

      const [goalAfter] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));
      const [initiativeAfter] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId));

      assert.equal(goalAfter!.updatedAt.getTime(), goalBefore!.updatedAt.getTime());
      assert.equal(initiativeAfter!.updatedAt.getTime(), initiativeBefore!.updatedAt.getTime());
      assert.equal(initiativeAfter!.status, initiativeBefore!.status);
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('10/11/12: memória nunca cria Action Plan, nunca executa tool, nunca cria approval', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      const itemsBefore = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, planId));
      const approvalsBefore = await db.select().from(agentApprovals);

      setLLMProviderOverrideForTests(mockProvider(memoryOutput()));
      await createStrategicMemoryFromReview(review, ceoUserId);

      const itemsAfter = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, planId));
      const approvalsAfter = await db.select().from(agentApprovals);

      assert.equal(itemsAfter.length, itemsBefore.length, 'nenhum Action Plan Item novo — memória nunca executa tool');
      assert.equal(approvalsAfter.length, approvalsBefore.length, 'nenhum approval novo criado pela memória');
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('4/5: idempotência — duas chamadas concorrentes geram só UMA memória; terceira chamada normal é idempotente', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      setLLMProviderOverrideForTests(delayedProvider(memoryOutput(), 200));
      const [a, b] = await Promise.all([createStrategicMemoryFromReview(review, ceoUserId), createStrategicMemoryFromReview(review, ceoUserId)]);

      assert.equal(a.memory.id, b.memory.id, 'as duas chamadas concorrentes devem convergir para a MESMA memória');
      assert.equal([a.created, b.created].filter(Boolean).length, 1, 'só uma das duas chamadas deveria ter efetivamente criado a memória');

      const rows = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, review.id));
      assert.equal(rows.length, 1, 'nenhuma memória duplicada persistida');

      const third = await createStrategicMemoryFromReview(review, ceoUserId);
      assert.equal(third.created, false, 'terceira chamada (normal, não concorrente) é idempotente');
      assert.equal(third.memory.id, a.memory.id);
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('7: ausência de lock durante o LLM — nenhuma transação fica "idle in transaction" durante a chamada ao provider', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      setLLMProviderOverrideForTests(delayedProvider(memoryOutput(), 800));
      const createPromise = createStrategicMemoryFromReview(review, ceoUserId);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const { rows } = await database.query<{ count: string }>(
        "select count(*)::int as count from pg_stat_activity where state = 'idle in transaction' and datname = current_database()",
      );
      assert.equal(Number(rows[0]!.count), 0, 'nenhuma conexão deveria estar com transação aberta e ociosa enquanto o extractor/LLM "roda"');

      const [draft] = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, review.id));
      assert.equal(draft!.status, 'draft');

      await createPromise;
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('6: falha do provider — memória não fica presa em draft, retry seguro cria normalmente', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      setLLMProviderOverrideForTests(failingProvider('Provider indisponível (teste).'));
      await assert.rejects(() => createStrategicMemoryFromReview(review, ceoUserId));

      const [afterFailure] = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, review.id));
      assert.equal(afterFailure, undefined, 'a linha draft deveria ter sido revertida (deletada), nunca presa para sempre');

      setLLMProviderOverrideForTests(mockProvider(memoryOutput()));
      const { memory, created } = await createStrategicMemoryFromReview(review, ceoUserId);
      assert.equal(created, true);
      assert.equal(memory.status, 'active');
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('listStrategicMemories nunca inclui draft por padrão (só via status="draft" explícito)', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      setLLMProviderOverrideForTests(delayedProvider(memoryOutput(), 500));
      const createPromise = createStrategicMemoryFromReview(review, ceoUserId);
      await new Promise((resolve) => setTimeout(resolve, 100)); // draft já deve existir, LLM ainda rodando

      const defaultList = await listStrategicMemories({ page: 1, limit: 100, initiativeId });
      assert.ok(!defaultList.rows.some((memory) => memory.sourceReviewId === review.id), 'draft nunca deveria aparecer sem status explícito');

      const draftList = await listStrategicMemories({ page: 1, limit: 100, initiativeId, status: 'draft' });
      assert.ok(draftList.rows.some((memory) => memory.sourceReviewId === review.id), 'status="draft" explícito deveria conseguir ver a draft');

      await createPromise;
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });

  test('archiveStrategicMemory: memória ativa pode ser arquivada; arquivada de novo é rejeitada (409)', async () => {
    const { review, initiativeId, planId } = await insertCompletedReview(goalId);
    try {
      setLLMProviderOverrideForTests(mockProvider(memoryOutput()));
      const { memory } = await createStrategicMemoryFromReview(review, ceoUserId);

      const archived = await archiveStrategicMemory(memory, ceoUserId);
      assert.equal(archived.status, 'archived');

      await assert.rejects(
        () => archiveStrategicMemory(archived, ceoUserId),
        (error: unknown) => error instanceof AgentError && error.code === 'conflict',
      );
    } finally {
      await cleanup(initiativeId, planId, review.id);
    }
  });
});
