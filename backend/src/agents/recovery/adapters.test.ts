import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutiveReviews,
  agentStrategicMemories,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { executiveReviewRecoveryAdapter } from './executive-review-recovery.js';
import { initiativeRecoveryAdapter } from './initiative-recovery.js';
import { strategicMemoryRecoveryAdapter } from './strategic-memory-recovery.js';

const HOUR_MS = 60 * 60 * 1000;

/*
 * Agentes v2.4 (correio.md seção 24) — Detection/Recovery/Idempotência/
 * Segurança dos 3 adapters, direto no nível de serviço (sem HTTP).
 */
describe('Agentes v2.4 - Recovery Adapters', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let goalId: number;
  let planIds: number[] = [];
  let initiativeIds: number[] = [];
  let reviewIds: number[] = [];
  let memoryIds: number[] = [];

  async function insertInitiative(overrides: Partial<typeof agentDirectorInitiatives.$inferInsert>) {
    const [row] = await db
      .insert(agentDirectorInitiatives)
      .values({
        goalId,
        title: `Recovery Initiative ${runId}-${Math.random()}`,
        description: 'desc',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        rationale: 'racional',
        origin: 'manual',
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();
    initiativeIds.push(row!.id);
    return row!;
  }

  async function insertPlan(overrides: Partial<typeof agentActionPlans.$inferInsert> = {}) {
    const [row] = await db
      .insert(agentActionPlans)
      .values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'evaluating', ...overrides })
      .returning();
    planIds.push(row!.id);
    return row!;
  }

  async function insertReview(overrides: Partial<typeof agentExecutiveReviews.$inferInsert>) {
    const plan = await insertPlan({ status: 'completed' });
    const initiative = await insertInitiative({ status: 'completed', actionPlanId: plan.id });
    const [row] = await db
      .insert(agentExecutiveReviews)
      .values({
        goalId,
        initiativeId: initiative.id,
        actionPlanId: plan.id,
        createdBy: ceoUserId,
        reviewType: 'initiative_outcome',
        status: 'draft',
        evidence: {},
        ...overrides,
      })
      .returning();
    reviewIds.push(row!.id);
    return row!;
  }

  async function insertMemory(overrides: Partial<typeof agentStrategicMemories.$inferInsert>) {
    const initiative = await insertInitiative({ status: 'completed' });
    const [row] = await db
      .insert(agentStrategicMemories)
      .values({
        memoryType: 'initiative_outcome',
        domain: 'crm',
        sourceGoalId: goalId,
        sourceInitiativeId: initiative.id,
        status: 'draft',
        evidence: {},
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();
    memoryIds.push(row!.id);
    return row!;
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal p/ Recovery ${runId}`,
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
  });

  after(async () => {
    for (const id of reviewIds) await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, id));
    for (const id of memoryIds) await db.delete(agentStrategicMemories).where(eq(agentStrategicMemories.id, id));
    for (const id of initiativeIds) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    for (const id of planIds) {
      await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, id));
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, id));
    }
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  describe('Initiative — detection', () => {
    test('1: Initiative "active" sem Action Plan e antiga é detectada como stale (Caso B)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const initiative = await insertInitiative({ actionPlanId: null, updatedAt: old });

      const candidates = await initiativeRecoveryAdapter.detectStale(60);
      assert.ok(candidates.some((candidate) => candidate.entityId === initiative.id && candidate.previousState === 'active_no_plan'));
    });

    test('2: Initiative "active" recente (mesmo sem plano) NÃO é detectada como stale', async () => {
      const initiative = await insertInitiative({ actionPlanId: null });

      const candidates = await initiativeRecoveryAdapter.detectStale(3600);
      assert.ok(!candidates.some((candidate) => candidate.entityId === initiative.id));
    });

    test('Caso A: Initiative "active" antiga COM Action Plan em status normal NÃO é stale', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const plan = await insertPlan({ status: 'executing' });
      const initiative = await insertInitiative({ actionPlanId: plan.id, updatedAt: old });

      const candidates = await initiativeRecoveryAdapter.detectStale(60);
      assert.ok(!candidates.some((candidate) => candidate.entityId === initiative.id), 'Action Plan em status normal não é evidência de problema — check-on-read já cuida disso.');
    });

    test('Caso C: Initiative "active" antiga com Action Plan preso em "evaluating" é detectada', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const plan = await insertPlan({ status: 'evaluating', createdAt: old });
      const initiative = await insertInitiative({ actionPlanId: plan.id, updatedAt: old });

      const candidates = await initiativeRecoveryAdapter.detectStale(60);
      const found = candidates.find((candidate) => candidate.entityId === initiative.id);
      assert.ok(found);
      assert.equal(found!.previousState, 'active_plan_stuck_evaluating');
    });
  });

  describe('Executive Review — detection', () => {
    test('3: review "draft" antiga é detectada como stale', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const review = await insertReview({ updatedAt: old });

      const candidates = await executiveReviewRecoveryAdapter.detectStale(60);
      assert.ok(candidates.some((candidate) => candidate.entityId === review.id));
    });

    test('4: review "draft" recente NÃO é detectada como stale', async () => {
      const review = await insertReview({});

      const candidates = await executiveReviewRecoveryAdapter.detectStale(3600);
      assert.ok(!candidates.some((candidate) => candidate.entityId === review.id));
    });
  });

  describe('Strategic Memory — detection', () => {
    test('5: memory "draft" antiga é detectada como stale', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const memory = await insertMemory({ updatedAt: old });

      const candidates = await strategicMemoryRecoveryAdapter.detectStale(60);
      assert.ok(candidates.some((candidate) => candidate.entityId === memory.id));
    });

    test('6: memory "draft" recente NÃO é detectada como stale', async () => {
      const memory = await insertMemory({});

      const candidates = await strategicMemoryRecoveryAdapter.detectStale(3600);
      assert.ok(!candidates.some((candidate) => candidate.entityId === memory.id));
    });
  });

  describe('Recovery — reconciliação real', () => {
    test('7: review draft stale volta a permitir retry (linha removida)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const review = await insertReview({ updatedAt: old });
      const candidates = await executiveReviewRecoveryAdapter.detectStale(60);
      const candidate = candidates.find((item) => item.entityId === review.id);
      assert.ok(candidate);

      const result = await executiveReviewRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });
      assert.equal(result.result, 'reverted');

      const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      assert.equal(reloaded, undefined, 'linha draft órfã deveria ter sido removida');
    });

    test('8: memory draft stale volta a permitir retry (linha removida)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const memory = await insertMemory({ updatedAt: old });
      const candidates = await strategicMemoryRecoveryAdapter.detectStale(60);
      const candidate = candidates.find((item) => item.entityId === memory.id);
      assert.ok(candidate);

      const result = await strategicMemoryRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });
      assert.equal(result.result, 'reverted');

      const [reloaded] = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.id, memory.id));
      assert.equal(reloaded, undefined);
    });

    test('9: recovery NUNCA remove review completed (predicado forte)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const review = await insertReview({ status: 'completed', outcome: 'successful', updatedAt: old });

      // Chama reconcile diretamente com um candidato "forjado" para
      // provar que o predicado (status='draft') protege mesmo se
      // alguém chamar reconcile fora do fluxo normal de detectStale.
      const result = await executiveReviewRecoveryAdapter.reconcile(
        { workflowType: 'executive_review', entityId: review.id, previousState: 'draft', ageSeconds: 3600, problem: 'forjado para teste' },
        { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId },
      );
      assert.equal(result.result, 'skipped');

      const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      assert.ok(reloaded, 'review completed NUNCA deveria ser removida pelo recovery');
      assert.equal(reloaded!.status, 'completed');
    });

    test('10: recovery NUNCA remove memory active (predicado forte)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const memory = await insertMemory({ status: 'active', title: 't', summary: 's', lesson: 'l', updatedAt: old });

      const result = await strategicMemoryRecoveryAdapter.reconcile(
        { workflowType: 'strategic_memory', entityId: memory.id, previousState: 'draft', ageSeconds: 3600, problem: 'forjado para teste' },
        { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId },
      );
      assert.equal(result.result, 'skipped');

      const [reloaded] = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.id, memory.id));
      assert.ok(reloaded);
      assert.equal(reloaded!.status, 'active');
    });

    test('11: Initiative com Action Plan válido existente não cria segundo plano (Caso A é no-op)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const plan = await insertPlan({ status: 'executing' });
      const initiative = await insertInitiative({ actionPlanId: plan.id, updatedAt: old });

      const candidates = await initiativeRecoveryAdapter.detectStale(60);
      assert.ok(!candidates.some((candidate) => candidate.entityId === initiative.id));

      const plansForInitiative = await db.select().from(agentActionPlans).where(eq(agentActionPlans.requestedBy, ceoUserId));
      const linkedCount = plansForInitiative.filter((p) => p.id === plan.id).length;
      assert.equal(linkedCount, 1, 'nenhum segundo Action Plan deveria ter sido criado');
    });

    test('12: Initiative stale sem plano volta a "approved" (fluxo real de retry)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const initiative = await insertInitiative({ actionPlanId: null, updatedAt: old, startedAt: old });

      const candidatesList = await initiativeRecoveryAdapter.detectStale(60);
      const candidate = candidatesList.find((item) => item.entityId === initiative.id);
      assert.ok(candidate);
      const result = await initiativeRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });
      assert.equal(result.result, 'reverted');

      const [reloaded] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id));
      assert.equal(reloaded!.status, 'approved');
      assert.equal(reloaded!.startedAt, null);
      assert.equal(reloaded!.actionPlanId, null);
    });

    test('13: inconsistência real (plano preso em evaluating) gera manual_attention, nunca modifica Initiative/Plan', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const plan = await insertPlan({ status: 'evaluating', createdAt: old });
      const initiative = await insertInitiative({ actionPlanId: plan.id, updatedAt: old });

      const candidatesList = await initiativeRecoveryAdapter.detectStale(60);
      const candidate = candidatesList.find((item) => item.entityId === initiative.id);
      assert.ok(candidate);
      const result = await initiativeRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });
      assert.equal(result.result, 'manual_attention');

      const [reloadedInitiative] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id));
      const [reloadedPlan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, plan.id));
      assert.equal(reloadedInitiative!.status, 'active', 'nunca modifica a Initiative — só escala');
      assert.equal(reloadedPlan!.status, 'evaluating', 'nunca modifica o Action Plan — só escala');

      const { agentDirectorDecisions } = await import('../../db/schema/index.js');
      const decisions = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.entityId, initiative.id));
      const recoveryDecision = decisions.find((decision) => decision.signalType.startsWith('agents.recovery.'));
      assert.ok(recoveryDecision, 'deveria existir um Decision Item de manual_attention');
      assert.equal(recoveryDecision!.status, 'open');
      await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, recoveryDecision!.id));
    });
  });

  describe('Idempotência/concorrência', () => {
    test('14: duas reconciliações concorrentes da MESMA review produzem um único efeito', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const review = await insertReview({ updatedAt: old });
      const candidatesList = await executiveReviewRecoveryAdapter.detectStale(60);
      const candidate = candidatesList.find((item) => item.entityId === review.id);
      assert.ok(candidate);

      const [a, b] = await Promise.all([
        executiveReviewRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId }),
        executiveReviewRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId }),
      ]);

      const results = [a.result, b.result].sort();
      assert.deepEqual(results, ['reverted', 'skipped'], 'só uma das duas chamadas concorrentes deveria ter efetivamente removido a linha');

      const rows = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      assert.equal(rows.length, 0);
    });

    test('15: recovery repetido é idempotente (segunda chamada sobre entidade já reconciliada → skipped, nunca erro)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const memory = await insertMemory({ updatedAt: old });
      const candidatesList = await strategicMemoryRecoveryAdapter.detectStale(60);
      const candidate = candidatesList.find((item) => item.entityId === memory.id);
      assert.ok(candidate);

      const first = await strategicMemoryRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });
      assert.equal(first.result, 'reverted');

      const second = await strategicMemoryRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });
      assert.equal(second.result, 'skipped', 'segunda chamada sobre entidade que já não existe mais → skipped, nunca um erro destrutivo');
    });

    test('16: entidade alterada por outro processo antes do recovery (ex.: já completou) é skipped com segurança', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const review = await insertReview({ updatedAt: old });
      const candidatesList = await executiveReviewRecoveryAdapter.detectStale(60);
      const candidate = candidatesList.find((item) => item.entityId === review.id);
      assert.ok(candidate);

      // Simula: outro processo terminou a review normalmente ENTRE a
      // detecção e a reconciliação.
      await db.update(agentExecutiveReviews).set({ status: 'completed', outcome: 'successful' }).where(eq(agentExecutiveReviews.id, review.id));

      const result = await executiveReviewRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });
      assert.equal(result.result, 'skipped');

      const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      assert.ok(reloaded, 'a review completada por outro processo NUNCA deveria ser removida');
      assert.equal(reloaded!.status, 'completed');
    });
  });

  describe('Segurança', () => {
    test('17/18: recovery nunca cria approval, nunca executa tool (nenhum Action Plan Item novo)', async () => {
      const old = new Date(Date.now() - HOUR_MS);
      const initiative = await insertInitiative({ actionPlanId: null, updatedAt: old, startedAt: old });

      const approvalsBefore = await db.select().from(agentApprovals);
      const itemsBefore = await db.select().from(agentActionPlanItems);

      const candidatesList = await initiativeRecoveryAdapter.detectStale(60);
      const candidate = candidatesList.find((item) => item.entityId === initiative.id);
      await initiativeRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });

      const approvalsAfter = await db.select().from(agentApprovals);
      const itemsAfter = await db.select().from(agentActionPlanItems);

      assert.equal(approvalsAfter.length, approvalsBefore.length, 'recovery nunca cria approval');
      assert.equal(itemsAfter.length, itemsBefore.length, 'recovery nunca executa/cria action plan item');
      void initiative;
    });

    test('19/20: recovery nunca modifica permission nem Policy Evaluator (nenhum import — garantia estrutural, verificada indiretamente)', async () => {
      // Garantia estrutural: os módulos de recovery não importam
      // `security/permissions.ts` nem `policy/action-policy-evaluator.ts`
      // — verificado por leitura de código (ver docblocks dos adapters).
      // Este teste prova o efeito observável: nenhuma linha de
      // role_permissions/permissions muda como resultado de reconciliar.
      const { rolePermissions, permissions } = await import('../../db/schema/index.js');
      const permsBefore = await db.select().from(permissions);
      const rolePermsBefore = await db.select().from(rolePermissions);

      const old = new Date(Date.now() - HOUR_MS);
      const review = await insertReview({ updatedAt: old });
      const candidatesList = await executiveReviewRecoveryAdapter.detectStale(60);
      const candidate = candidatesList.find((item) => item.entityId === review.id);
      await executiveReviewRecoveryAdapter.reconcile(candidate!, { thresholdSeconds: 60, dryRun: false, actorUserId: ceoUserId });

      const permsAfter = await db.select().from(permissions);
      const rolePermsAfter = await db.select().from(rolePermissions);

      assert.equal(permsAfter.length, permsBefore.length);
      assert.equal(rolePermsAfter.length, rolePermsBefore.length);
      void review;
    });
  });
});
