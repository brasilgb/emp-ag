import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoalEvaluations, agentDirectorGoalMetrics, agentDirectorGoals } from '../../../db/schema/index.js';

import { computeHealth, computeHealthFactors } from './health.js';
import { getMetricCatalogEntry } from './metrics/catalog.js';
import type { GoalEvaluationResult, MetricSnapshotEntry } from './types.js';

export type GoalRow = typeof agentDirectorGoals.$inferSelect;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Progresso 0-100 de UMA métrica, conforme a direção (correio.md seção 3). */
function metricProgress(current: number, target: number, direction: MetricSnapshotEntry['direction']): number {
  if (direction === 'increase') {
    if (target <= 0) return current >= target ? 100 : 0;
    return clampPercent((current / target) * 100);
  }

  if (direction === 'decrease') {
    if (current <= target) return 100;
    const base = Math.max(target, 1);
    return clampPercent(100 - ((current - target) / base) * 100);
  }

  // maintain: quanto mais perto do target, melhor — desvio relativo penaliza os dois lados.
  const base = Math.max(Math.abs(target), 1);
  const deviation = Math.abs(current - target) / base;
  return clampPercent(100 - deviation * 100);
}

/**
 * Agentes v2.0 (correio.md seção 5) — função central de avaliação.
 * `now` sempre injetável. Retorna `null` quando o Goal não existe
 * (mesmo padrão de `getDecisionById` na v1.9 — a rota resolve o 404).
 */
export async function evaluateDirectorGoal(
  goalId: number,
  options: { now?: Date } = {},
): Promise<{ goal: GoalRow; evaluation: GoalEvaluationResult } | null> {
  const now = options.now ?? new Date();

  const [goal] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId)).limit(1);
  if (!goal) return null;

  const metrics = await db.select().from(agentDirectorGoalMetrics).where(eq(agentDirectorGoalMetrics.goalId, goalId));

  let progressPercent = goal.progressPercent;
  let currentValueOut: number | null = goal.currentValue !== null ? Number(goal.currentValue) : null;
  const metricSnapshot: MetricSnapshotEntry[] = [];

  if (goal.targetType === 'metric') {
    if (metrics.length > 0) {
      let weightedSum = 0;
      let totalWeight = 0;

      for (const metric of metrics) {
        const catalogEntry = getMetricCatalogEntry(metric.metricKey);
        // metricKey inválido/removido do catálogo: preserva o último valor
        // conhecido, nunca falha a avaliação inteira do Goal por causa de
        // uma métrica (mesmo racional de "falha isolada por domínio" da
        // v1.8 — collectOperationalSignals/Promise.allSettled).
        const current = catalogEntry ? await catalogEntry.evaluate({ startDate: goal.startDate, now }) : Number(metric.currentValue ?? 0);
        const target = Number(metric.targetValue);
        const direction = metric.direction as MetricSnapshotEntry['direction'];
        const progress = metricProgress(current, target, direction);

        weightedSum += progress * metric.weight;
        totalWeight += metric.weight;

        metricSnapshot.push({ metricKey: metric.metricKey, currentValue: current, targetValue: target, direction, weight: metric.weight, progressPercent: progress });

        await db
          .update(agentDirectorGoalMetrics)
          .set({ currentValue: String(current), lastEvaluatedAt: now, updatedAt: now })
          .where(eq(agentDirectorGoalMetrics.id, metric.id));
      }

      progressPercent = totalWeight > 0 ? clampPercent(weightedSum / totalWeight) : 0;
      // currentValue/unit do Goal só fazem sentido 1:1 quando há uma
      // única métrica (correio.md não define agregação de unidades
      // heterogêneas) — Goals com múltiplas métricas usam só
      // progressPercent como sinal agregado (seção 11: "escolher
      // conscientemente entre persistir e derivar").
      currentValueOut = metrics.length === 1 ? metricSnapshot[0]!.currentValue : null;
    } else if (goal.targetValue !== null && goal.currentValue !== null) {
      // Goal "metric" sem métricas associadas mas com targetValue/
      // currentValue preenchidos manualmente — trata como increase.
      progressPercent = metricProgress(Number(goal.currentValue), Number(goal.targetValue), 'increase');
    } else {
      // Goal sem métrica e sem valor manual: nenhum dado para calcular
      // progresso — mantém 0, o health vai refletir isso via deviation.
      progressPercent = 0;
      currentValueOut = null;
    }
  }
  // targetType === 'milestone': progressPercent vem de fora (PATCH manual), não recalculado aqui.

  const factors = computeHealthFactors({ progressPercent, startDate: goal.startDate, targetDate: goal.targetDate, now });
  const health = computeHealth(factors, progressPercent >= 100);

  const nextStatus =
    goal.status === 'active' && progressPercent >= 100
      ? 'achieved'
      : goal.status === 'active' && factors.isOverdue && progressPercent < 100
        ? 'missed'
        : goal.status;

  const [updatedGoal] = await db
    .update(agentDirectorGoals)
    .set({
      progressPercent,
      currentValue: currentValueOut !== null ? String(currentValueOut) : null,
      health,
      lastEvaluatedAt: now,
      status: nextStatus,
      completedAt: nextStatus === 'achieved' && goal.status !== 'achieved' ? now : goal.completedAt,
      updatedAt: now,
    })
    .where(eq(agentDirectorGoals.id, goalId))
    .returning();

  await db.insert(agentDirectorGoalEvaluations).values({
    goalId,
    evaluatedAt: now,
    progressPercent,
    health,
    metricSnapshot,
    factors,
  });

  return {
    goal: updatedGoal!,
    evaluation: { progressPercent, health, factors, metricSnapshot, currentValue: currentValueOut },
  };
}
