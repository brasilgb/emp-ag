import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoals, agentDirectorInitiatives, users } from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';

import { reviewDirectorGoals } from './review-service.js';

/*
 * Agentes v2.0 (correio.md seção 11/23) — Director Goal Review: gera
 * recomendação de Initiative para Goals at_risk/critical, deduplicada
 * (uma mesma condição não gera dezenas de initiatives equivalentes).
 *
 * `reviewDirectorGoals()` varre TODOS os Goals `active` do banco (mesmo
 * racional de `syncDirectorDecisionQueue()` na v1.9) — cada teste cria e
 * DELETA seu próprio Goal ao final (nunca deferido para um `after` no
 * fim do arquivo), para que `summary.evaluated`/`recommendationsCreated`
 * possam ser comparados com exatidão sem interferência entre testes.
 */
describe('Agentes v2.0 - reviewDirectorGoals', () => {
  const runId = Date.now() % 1_000_000;
  const START = new Date('2026-01-01T00:00:00.000Z');
  const TARGET = new Date('2026-01-11T00:00:00.000Z');
  let goalCounter = 0;
  let userId: number;

  async function insertGoal(overrides: Partial<typeof agentDirectorGoals.$inferInsert> = {}) {
    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal Review ${runId}-${goalCounter++}`,
        description: 'Goal de teste.',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        createdBy: userId,
        startDate: START,
        targetDate: TARGET,
        targetType: 'milestone',
        progressPercent: 0,
        health: 'unknown',
        ...overrides,
      })
      .returning();
    return goal!;
  }

  async function deleteGoal(id: number) {
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, id));
  }

  after(async () => {
    await database.end();
    redis.disconnect();
  });

  test('setup', async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    assert.ok(user);
    userId = user.id;
  });

  test('Goal draft nunca é avaliado por reviewDirectorGoals (só "active")', async () => {
    const goal = await insertGoal({ status: 'draft' });
    try {
      const summary = await reviewDirectorGoals(new Date('2026-01-06T00:00:00.000Z'));
      assert.equal(summary.evaluated, 0);

      const [reloaded] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, goal.id));
      assert.equal(reloaded!.health, 'unknown');
    } finally {
      await deleteGoal(goal.id);
    }
  });

  test('Goal critical gera UMA recomendação de Initiative, com recommendationKey determinístico', async () => {
    const goal = await insertGoal(); // deviation muito negativo aos 50% do prazo => critical
    try {
      const summary = await reviewDirectorGoals(new Date('2026-01-06T00:00:00.000Z'));
      assert.equal(summary.evaluated, 1);
      assert.equal(summary.recommendationsCreated, 1);

      const initiatives = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      assert.equal(initiatives.length, 1);
      assert.equal(initiatives[0]!.origin, 'director_recommendation');
      assert.equal(initiatives[0]!.recommendationKey, `goal-health:${goal.id}:critical`);
      assert.equal(initiatives[0]!.status, 'proposed');
    } finally {
      await deleteGoal(goal.id);
    }
  });

  test('rodar de novo com a mesma condição não duplica a recomendação', async () => {
    const goal = await insertGoal();
    try {
      const now = new Date('2026-01-06T00:00:00.000Z');
      await reviewDirectorGoals(now);
      const summary2 = await reviewDirectorGoals(now);
      assert.equal(summary2.recommendationsCreated, 0, 'segunda chamada não deve criar nova recomendação');

      const initiatives = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      assert.equal(initiatives.length, 1, 'ainda deve haver só UMA recomendação para esta condição');
    } finally {
      await deleteGoal(goal.id);
    }
  });

  test('Goal on_track (progresso em dia) não gera recomendação nenhuma', async () => {
    const goal = await insertGoal({ progressPercent: 55 }); // à frente do tempo decorrido (50%)
    try {
      const summary = await reviewDirectorGoals(new Date('2026-01-06T00:00:00.000Z'));
      assert.equal(summary.recommendationsCreated, 0);

      const initiatives = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      assert.equal(initiatives.length, 0);
    } finally {
      await deleteGoal(goal.id);
    }
  });

  test('reincidência: recomendação TERMINAL (cancelled) é REABERTA na mesma linha, nunca duplicada', async () => {
    const goal = await insertGoal();
    try {
      const now1 = new Date('2026-01-06T00:00:00.000Z');
      const summary1 = await reviewDirectorGoals(now1);
      assert.equal(summary1.recommendationsCreated, 1);
      assert.equal(summary1.recommendationsReopened, 0);

      const [created] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      assert.equal(created!.status, 'proposed');
      const firstId = created!.id;

      // CEO trata a recomendação e cancela (ciclo de risco encerrado).
      await db
        .update(agentDirectorInitiatives)
        .set({ status: 'cancelled', cancelledAt: now1, cancellationReason: 'tratado manualmente' })
        .where(eq(agentDirectorInitiatives.id, firstId));

      // Reincidência: mesma condição (mesmo goalId + health) aparece de novo.
      const now2 = new Date('2026-01-07T00:00:00.000Z');
      const summary2 = await reviewDirectorGoals(now2);
      assert.equal(summary2.recommendationsCreated, 0, 'reincidência não é uma criação nova');
      assert.equal(summary2.recommendationsReopened, 1, 'reincidência sobre recomendação terminal é uma reabertura');

      const initiatives = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      assert.equal(initiatives.length, 1, 'nunca duplica — reabre a MESMA linha');
      assert.equal(initiatives[0]!.id, firstId, 'é literalmente a mesma linha, não uma nova');
      assert.equal(initiatives[0]!.status, 'proposed');
      assert.equal(initiatives[0]!.cancelledAt, null, 'reopen limpa os campos de cancelamento');
      assert.equal(initiatives[0]!.cancellationReason, null);
    } finally {
      await deleteGoal(goal.id);
    }
  });

  test('recomendação ainda ABERTA (proposed/approved/active/blocked) nunca é reescrita por uma nova avaliação', async () => {
    const goal = await insertGoal();
    try {
      const now1 = new Date('2026-01-06T00:00:00.000Z');
      await reviewDirectorGoals(now1);

      const [created] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      // Usuário aprova — estado não-terminal.
      await db.update(agentDirectorInitiatives).set({ status: 'approved' }).where(eq(agentDirectorInitiatives.id, created!.id));

      const now2 = new Date('2026-01-07T00:00:00.000Z');
      const summary2 = await reviewDirectorGoals(now2);
      assert.equal(summary2.recommendationsCreated, 0);
      assert.equal(summary2.recommendationsReopened, 0, 'linha aberta não conta como reopen — setWhere não aplicou o UPDATE');

      const [reloaded] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, created!.id));
      assert.equal(reloaded!.status, 'approved', 'status aprovado pelo usuário nunca é sobrescrito por uma nova avaliação automática');
    } finally {
      await deleteGoal(goal.id);
    }
  });

  test('concorrência: duas chamadas simultâneas para o mesmo Goal critical não duplicam a recomendação', async () => {
    const goal = await insertGoal();
    try {
      const now = new Date('2026-01-06T00:00:00.000Z');
      await Promise.all([reviewDirectorGoals(now), reviewDirectorGoals(now)]);

      const initiatives = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      assert.equal(initiatives.length, 1);
    } finally {
      await deleteGoal(goal.id);
    }
  });

  test('concorrência: duas reincidências simultâneas sobre uma recomendação terminal reabrem a MESMA linha, nunca duplicam', async () => {
    const goal = await insertGoal();
    try {
      const now1 = new Date('2026-01-06T00:00:00.000Z');
      await reviewDirectorGoals(now1);
      const [created] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      await db.update(agentDirectorInitiatives).set({ status: 'completed', completedAt: now1 }).where(eq(agentDirectorInitiatives.id, created!.id));

      const now2 = new Date('2026-01-07T00:00:00.000Z');
      await Promise.all([reviewDirectorGoals(now2), reviewDirectorGoals(now2)]);

      const initiatives = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.goalId, goal.id));
      assert.equal(initiatives.length, 1, 'reabertura concorrente nunca cria uma segunda linha');
      assert.equal(initiatives[0]!.id, created!.id);
      assert.equal(initiatives[0]!.status, 'proposed');
    } finally {
      await deleteGoal(goal.id);
    }
  });
});
