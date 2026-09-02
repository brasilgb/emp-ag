import type { SignalDomain, SignalSeverity } from '../types.js';

export const DECISION_STATUSES = [
  'open',
  'acknowledged',
  'action_planned',
  'awaiting_approval',
  'resolved',
  'dismissed',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

// Estados nao-terminais - itens que ainda "existem" na fila ativa.
export const OPEN_DECISION_STATUSES: readonly DecisionStatus[] = [
  'open',
  'acknowledged',
  'action_planned',
  'awaiting_approval',
];

export type DecisionImpact = 'high' | 'medium' | 'low';
export type DecisionUrgency = 'immediate' | 'soon' | 'normal';

export interface PriorityFactors {
  severity: { value: SignalSeverity; weight: number };
  impact: { value: DecisionImpact; weight: number };
  urgency: { value: DecisionUrgency; weight: number };
  aging: { days: number; weight: number };
  recurrence: { count: number; weight: number };
  total: number;
}

export interface DecisionSyncSummary {
  created: number;
  updated: number;
  resolved: number;
  unchanged: number;
  errors: { domain: SignalDomain; code: string; message: string }[];
}
