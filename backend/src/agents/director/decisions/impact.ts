import type { OperationalSignal } from '../types.js';
import { FINANCE_IMPACT_AMOUNT_THRESHOLDS, IMPACT_BY_SIGNAL_TYPE, INCIDENT_REASON_IMPACT } from './thresholds.js';
import type { DecisionImpact } from './types.js';

/**
 * Agentes v1.9 (correio.md secao 9) - nunca inventado pelo LLM, regra
 * fechada por signalType. `finance.*` usa o valor real do sinal
 * (`metadata.amount`, ja gravado por collectFinanceSignals) quando
 * disponivel - "caso uma fonte necessaria nao esteja no signal, ampliar
 * o collector somente se puder faze-lo usando service/repository
 * oficial do dominio" - o valor ja estava disponivel, nenhuma
 * ampliacao de collector foi necessaria.
 */
export function resolveImpact(signal: Pick<OperationalSignal, 'type' | 'metadata'>): DecisionImpact {
  if (signal.type === 'finance.receivable_overdue' || signal.type === 'finance.payable_overdue') {
    const amount = Number(signal.metadata.amount);

    if (Number.isFinite(amount)) {
      if (amount >= FINANCE_IMPACT_AMOUNT_THRESHOLDS.high) return 'high';
      if (amount >= FINANCE_IMPACT_AMOUNT_THRESHOLDS.medium) return 'medium';
      return 'low';
    }
  }

  if (signal.type.startsWith('agents.incident.')) {
    const reason = signal.type.slice('agents.incident.'.length);
    return INCIDENT_REASON_IMPACT[reason] ?? 'medium';
  }

  return IMPACT_BY_SIGNAL_TYPE[signal.type] ?? 'medium';
}
