import type { SignalSeverity } from '../types.js';
import { PRIORITY_WEIGHTS } from './thresholds.js';
import type { DecisionImpact, DecisionUrgency, PriorityFactors } from './types.js';

/**
 * Agentes v1.9 (correio.md secao 8) - determinístico, testavel,
 * documentado, estavel. Soma simples e explicavel (nunca uma formula
 * opaca) de 5 dimensoes, cada uma com peso capado independentemente -
 * nenhuma dimensao domina o score sozinha.
 */
export function computePriority(params: {
  severity: SignalSeverity;
  impact: DecisionImpact;
  urgency: DecisionUrgency;
  agingDays: number;
  occurrenceCount: number;
}): PriorityFactors {
  const severityWeight = PRIORITY_WEIGHTS.severity[params.severity];
  const impactWeight = PRIORITY_WEIGHTS.impact[params.impact];
  const urgencyWeight = PRIORITY_WEIGHTS.urgency[params.urgency];

  const agingWeight = Math.min(
    Math.max(params.agingDays, 0) * PRIORITY_WEIGHTS.agingPointsPerDay,
    PRIORITY_WEIGHTS.agingCap,
  );

  const recurrenceWeight = Math.min(
    Math.max(params.occurrenceCount - 1, 0) * PRIORITY_WEIGHTS.recurrencePointsPerOccurrence,
    PRIORITY_WEIGHTS.recurrenceCap,
  );

  const total = severityWeight + impactWeight + urgencyWeight + agingWeight + recurrenceWeight;

  return {
    severity: { value: params.severity, weight: severityWeight },
    impact: { value: params.impact, weight: impactWeight },
    urgency: { value: params.urgency, weight: urgencyWeight },
    aging: { days: params.agingDays, weight: agingWeight },
    recurrence: { count: params.occurrenceCount, weight: recurrenceWeight },
    total,
  };
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}
