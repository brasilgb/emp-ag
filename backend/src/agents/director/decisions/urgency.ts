import type { OperationalSignal } from '../types.js';
import { INCIDENT_REASON_URGENCY, URGENCY_BY_SIGNAL_TYPE } from './thresholds.js';
import type { DecisionUrgency } from './types.js';

/** Agentes v1.9 (correio.md secao 10) - baseline estatico por signalType, ver justificativa em thresholds.ts. */
export function resolveUrgency(signal: Pick<OperationalSignal, 'type'>): DecisionUrgency {
  if (signal.type.startsWith('agents.incident.')) {
    const reason = signal.type.slice('agents.incident.'.length);
    return INCIDENT_REASON_URGENCY[reason] ?? 'soon';
  }

  return URGENCY_BY_SIGNAL_TYPE[signal.type] ?? 'normal';
}
