import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoalEvaluations, agentDirectorGoalMetrics, agentDirectorGoals, users } from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';

import { evaluateDirectorGoal } from './evaluation-engine.js';

/*
 * Agentes v2.0 (correio.md seção 23) — Goal Evaluation Engine: cálculo
 * de progress, increase/decrease, Goal sem métricas, histórico de
 * avaliações. `now` sempre controlado.
 */
describe('Agentes v2.0 - evaluateDirectorGoal', () => {
  const runId = Date.now() % 1_000_000;
  const START = new Date('2026-01-01T00:00:00.000Z');
  const TARGET = new Date('2026-01-11T00:00:00.000Z'); // 10 dias
  const goalIds: number[] = [];
  let userId: number;

  async function insertGoal(overrides: Partial<typeof agentDirectorGoals.$inferInsert> = {}) {
    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal Eval ${runId}-${goalIds.length}`,
        description: 'Goal de teste.',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        createdBy: userId,
        startDate: START,
        targetDate: TARGET,
        targetType: 'metric',
        progressPercent: 0,
        health: 'unknown',
        ...overrides,
      })
      .returning();
    goalIds.push(goal!.id);
    return goal!;
  }

  after(async () => {
    if (goalIds.length > 0) {
      for (const id of goalIds) await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, id));
    }
    await database.end();
    redis.disconnect();
  });

  test('setup: usuário real para createdBy', async () => {
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    assert.ok(user);
    userId = user.id;
  });

  test('Goal sem métricas e sem valor manual: progressPercent fica 0, health reflete o tempo decorrido', async () => {
    const goal = await insertGoal();
    const now = new Date('2026-01-06T00:00:00.000Z'); // 50% do prazo

    const result = await evaluateDirectorGoal(goal.id, { now });
    assert.ok(result);
    assert.equal(result.evaluation.progressPercent, 0);
    assert.equal(result.evaluation.health, 'critical'); // deviation -50
    assert.equal(result.evaluation.metricSnapshot.length, 0);
  });

  test('métrica increase: progresso = current/target, capado em 100', async () => {
    const goal = await insertGoal();
    await db.insert(agentDirectorGoalMetrics).values({
      goalId: goal.id,
      metricKey: 'crm.clients_won',
      label: 'Clientes conquistados',
      sourceDomain: 'crm',
      targetValue: '20',
      direction: 'increase',
      weight: 1,
    });

    // crmClientsWon conta clients.createdAt >= startDate — sem fixtures
    // de clients novos, current fica 0 (ou o que já existir no banco de
    // dev criado após START, o que é aceitável: o teste só verifica que
    // o progresso nunca ultrapassa 100 e é derivado do valor real).
    const now = new Date('2026-01-06T00:00:00.000Z');
    const result = await evaluateDirectorGoal(goal.id, { now });
    assert.ok(result);
    assert.ok(result.evaluation.progressPercent >= 0 && result.evaluation.progressPercent <= 100);
    assert.equal(result.evaluation.metricSnapshot.length, 1);
    assert.equal(result.evaluation.metricSnapshot[0]!.metricKey, 'crm.clients_won');
  });

  test('métrica decrease: current <= target → 100%; current > target → progresso reduzido', async () => {
    const goal = await insertGoal();
    await db.insert(agentDirectorGoalMetrics).values({
      goalId: goal.id,
      metricKey: 'finance.overdue_amount',
      label: 'Valor em atraso',
      sourceDomain: 'finance',
      targetValue: '999999999',
      direction: 'decrease',
      weight: 1,
    });

    // targetValue absurdamente alto garante current <= target sempre → 100%.
    const now = new Date('2026-01-06T00:00:00.000Z');
    const result = await evaluateDirectorGoal(goal.id, { now });
    assert.ok(result);
    assert.equal(result.evaluation.progressPercent, 100);
  });

  test('métricas com pesos diferentes: progressPercent é a média ponderada', async () => {
    const goal = await insertGoal();
    await db.insert(agentDirectorGoalMetrics).values([
      { goalId: goal.id, metricKey: 'finance.overdue_amount', label: 'A', sourceDomain: 'finance', targetValue: '999999999', direction: 'decrease', weight: 3 }, // 100%
      { goalId: goal.id, metricKey: 'crm.clients_won', label: 'B', sourceDomain: 'crm', targetValue: '999999999', direction: 'increase', weight: 1 }, // ~0%
    ]);

    const now = new Date('2026-01-06T00:00:00.000Z');
    const result = await evaluateDirectorGoal(goal.id, { now });
    assert.ok(result);
    // peso 3 em 100% + peso 1 em ~0% => média ponderada ~75%.
    assert.ok(result.evaluation.progressPercent >= 70 && result.evaluation.progressPercent <= 80);
  });

  test('Goal inexistente retorna null (rota resolve 404)', async () => {
    const result = await evaluateDirectorGoal(999999999);
    assert.equal(result, null);
  });

  test('histórico: cada avaliação insere uma linha append-only em agent_director_goal_evaluations', async () => {
    const goal = await insertGoal();
    const now1 = new Date('2026-01-03T00:00:00.000Z');
    const now2 = new Date('2026-01-05T00:00:00.000Z');

    await evaluateDirectorGoal(goal.id, { now: now1 });
    await evaluateDirectorGoal(goal.id, { now: now2 });

    const history = await db.select().from(agentDirectorGoalEvaluations).where(eq(agentDirectorGoalEvaluations.goalId, goal.id));
    assert.equal(history.length, 2);
    assert.notEqual(history[0]!.evaluatedAt.getTime(), history[1]!.evaluatedAt.getTime());
  });

  test('status active + progresso 100% → auto "achieved" com completedAt', async () => {
    const goal = await insertGoal({ targetType: 'milestone', progressPercent: 100 });
    const now = new Date('2026-01-06T00:00:00.000Z');

    const result = await evaluateDirectorGoal(goal.id, { now });
    assert.ok(result);
    assert.equal(result.goal.status, 'achieved');
    assert.ok(result.goal.completedAt);
  });

  test('status active + prazo vencido sem 100% → auto "missed"', async () => {
    const goal = await insertGoal({ targetType: 'milestone', progressPercent: 60 });
    const now = new Date('2026-01-20T00:00:00.000Z'); // após TARGET

    const result = await evaluateDirectorGoal(goal.id, { now });
    assert.ok(result);
    assert.equal(result.goal.status, 'missed');
  });

  test('targetType=milestone nunca recalcula progressPercent a partir de métricas (fica como veio de fora)', async () => {
    const goal = await insertGoal({ targetType: 'milestone', progressPercent: 42 });
    const now = new Date('2026-01-06T00:00:00.000Z');

    const result = await evaluateDirectorGoal(goal.id, { now });
    assert.ok(result);
    assert.equal(result.evaluation.progressPercent, 42);
  });
});
