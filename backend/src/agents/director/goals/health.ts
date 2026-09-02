import { HEALTH_DEVIATION_THRESHOLDS, HEALTH_RANK } from './thresholds.js';
import type { GoalHealth, GoalHealthFactors } from './types.js';

/**
 * Agentes v2.0 (correio.md secao 6) - algoritmo deterministico e
 * explicavel. `now` sempre injetavel (nunca `new Date()`/`Date.now()`
 * direto na regra de negocio).
 */
export function computeHealthFactors(params: {
  progressPercent: number;
  startDate: Date;
  targetDate: Date;
  now: Date;
}): GoalHealthFactors {
  const { progressPercent, startDate, targetDate, now } = params;

  const totalMs = Math.max(targetDate.getTime() - startDate.getTime(), 1);
  const elapsedMs = Math.max(now.getTime() - startDate.getTime(), 0);
  const timeElapsedPercent = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

  const daysRemaining = Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  const isOverdue = now.getTime() > targetDate.getTime();

  return {
    progressPercent,
    timeElapsedPercent,
    deviation: progressPercent - timeElapsedPercent,
    daysRemaining,
    isOverdue,
  };
}

/**
 * Traduz os fatores em um health de 5 estados. `unknown` é reservado
 * para Goals ainda sem nenhuma avaliação (não calculado aqui — ver
 * evaluation-engine.ts, que só chama esta função quando já há
 * progressPercent calculado).
 */
export function computeHealth(factors: GoalHealthFactors, progressComplete: boolean): GoalHealth {
  if (progressComplete) return 'on_track';

  let rankIndex: number;
  if (factors.deviation >= HEALTH_DEVIATION_THRESHOLDS.attentionAt) rankIndex = 0;
  else if (factors.deviation >= HEALTH_DEVIATION_THRESHOLDS.atRiskAt) rankIndex = 1;
  else if (factors.deviation >= HEALTH_DEVIATION_THRESHOLDS.criticalAt) rankIndex = 2;
  else rankIndex = 3;

  // Prazo vencido sem conclusão nunca fica on_track, mesmo com desvio pequeno.
  if (factors.isOverdue) rankIndex = Math.max(rankIndex, 2);

  return HEALTH_RANK[rankIndex] as GoalHealth;
}
