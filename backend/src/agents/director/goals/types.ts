export const GOAL_STATUSES = ['draft', 'active', 'paused', 'achieved', 'missed', 'cancelled'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

// Estados nao-terminais - aceitam nova avaliacao/edicao.
export const OPEN_GOAL_STATUSES: readonly GoalStatus[] = ['draft', 'active', 'paused'];

export const GOAL_HEALTHS = ['on_track', 'attention', 'at_risk', 'critical', 'unknown'] as const;
export type GoalHealth = (typeof GOAL_HEALTHS)[number];

export const GOAL_TARGET_TYPES = ['metric', 'milestone'] as const;
export type GoalTargetType = (typeof GOAL_TARGET_TYPES)[number];

export const METRIC_DIRECTIONS = ['increase', 'decrease', 'maintain'] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const INITIATIVE_STATUSES = ['proposed', 'approved', 'active', 'blocked', 'completed', 'cancelled'] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export const OPEN_INITIATIVE_STATUSES: readonly InitiativeStatus[] = ['proposed', 'approved', 'active', 'blocked'];

export const INITIATIVE_ORIGINS = ['manual', 'director_recommendation'] as const;
export type InitiativeOrigin = (typeof INITIATIVE_ORIGINS)[number];

/**
 * Agentes v2.0 (correio.md secao 6) - fatores explicaveis do calculo de
 * health, persistidos em agent_director_goal_evaluations.factors (mesmo
 * racional de PriorityFactors em decisions/types.ts).
 */
export interface GoalHealthFactors {
  progressPercent: number;
  timeElapsedPercent: number;
  /** progressPercent - timeElapsedPercent: negativo = atrasado em relacao ao tempo decorrido. */
  deviation: number;
  daysRemaining: number;
  isOverdue: boolean;
}

export interface MetricSnapshotEntry {
  metricKey: string;
  currentValue: number;
  targetValue: number;
  direction: MetricDirection;
  weight: number;
  /** Progresso individual desta metrica, 0-100 (capado). */
  progressPercent: number;
}

export interface GoalEvaluationResult {
  progressPercent: number;
  health: GoalHealth;
  factors: GoalHealthFactors;
  metricSnapshot: MetricSnapshotEntry[];
  currentValue: number | null;
}
