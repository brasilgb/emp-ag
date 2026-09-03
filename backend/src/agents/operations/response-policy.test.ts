import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateResponsePolicy } from './response-policy.js';
import type { OperationalIncident } from './health-types.js';

function incident(overrides: Partial<OperationalIncident> = {}): OperationalIncident {
  return {
    id: 'test:agent_job:1',
    type: 'repeated_job_failure',
    severity: 'critical',
    entityType: 'agent_job',
    entityId: '1',
    problem: 'problema de teste',
    detectedAt: new Date().toISOString(),
    signals: [],
    ...overrides,
  };
}

/*
 * Agentes v2.5 (correio.md seção 28, "Policy") — tabela de decisão pura,
 * NUNCA decidida por LLM (seção 2/34) — testável exaustivamente.
 */
describe('Agentes v2.5 - evaluateResponsePolicy (Response Policy)', () => {
  test('11: condição observável (recovery_required nunca é "observe" — ver mapeamento; run_stuck é o caso real de "observe")', () => {
    const decision = evaluateResponsePolicy(incident({ type: 'run_stuck', severity: 'warning', entityType: 'agent_job_run', entityId: '9' }));
    assert.equal(decision.response, 'observe');
  });

  test('12: stale recuperável → safe_recovery', () => {
    const decision = evaluateResponsePolicy(incident({ type: 'recovery_required', severity: 'warning', entityType: 'executive_review', entityId: '5' }));
    assert.equal(decision.response, 'safe_recovery');
  });

  test('13: condição perigosa (repeated_job_failure crítico, autonomia ainda ligada) → restrict_autonomy', () => {
    const decision = evaluateResponsePolicy(incident({ severity: 'critical' }), { jobAutonomyEnabled: true });
    assert.equal(decision.response, 'restrict_autonomy');
  });

  test('14: condição não reconciliável (repeated_job_failure crítico, autonomia JÁ restrita) → manual_attention', () => {
    const decision = evaluateResponsePolicy(incident({ severity: 'critical' }), { jobAutonomyEnabled: false });
    assert.equal(decision.response, 'manual_attention');
  });

  test('repeated_job_failure abaixo do threshold (severity warning) → observe, nunca restrict_autonomy', () => {
    const decision = evaluateResponsePolicy(incident({ severity: 'warning' }), { jobAutonomyEnabled: true });
    assert.equal(decision.response, 'observe');
  });

  test('autonomy_circuit_open → already_handled (Circuit Breaker já restringiu sozinho)', () => {
    const decision = evaluateResponsePolicy(incident({ type: 'autonomy_circuit_open', entityType: 'agent_job', entityId: '2' }));
    assert.equal(decision.response, 'already_handled');
  });

  test('manual_attention_required → already_handled (já é um Decision Item real aberto)', () => {
    const decision = evaluateResponsePolicy(incident({ type: 'manual_attention_required', entityType: 'agent_director_decision', entityId: '3' }));
    assert.equal(decision.response, 'already_handled');
  });

  test('approval_bottleneck → observe (nunca auto-aprova/rejeita)', () => {
    const decision = evaluateResponsePolicy(incident({ type: 'approval_bottleneck', entityType: 'agent_approvals_backlog', entityId: 'global' }));
    assert.equal(decision.response, 'observe');
  });

  test('delivery_failure → observe', () => {
    const decision = evaluateResponsePolicy(incident({ type: 'delivery_failure', entityType: 'agent_event_rule', entityId: '4' }));
    assert.equal(decision.response, 'observe');
  });

  test('operational_degradation (autonomia global desligada) → observe, nunca reativa sozinho', () => {
    const decision = evaluateResponsePolicy(incident({ type: 'operational_degradation', entityType: 'agent_global_autonomy', entityId: 'global' }));
    assert.equal(decision.response, 'observe');
  });
});
