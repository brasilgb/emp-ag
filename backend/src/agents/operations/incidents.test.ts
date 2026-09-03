import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { classifyIncidents } from './incidents.js';
import type { OperationalSignal } from './health-types.js';

function signal(overrides: Partial<OperationalSignal> = {}): OperationalSignal {
  return {
    type: 'job_repeated_failure',
    severity: 'critical',
    source: 'test',
    entityType: 'agent_job',
    entityId: '1',
    detectedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    reason: 'motivo de teste',
    ...overrides,
  };
}

/*
 * Agentes v2.5 (correio.md seção 28, "Classification") — classifyIncidents
 * é PURA (sem banco), testável exaustivamente sem mock nenhum.
 */
describe('Agentes v2.5 - classifyIncidents (correlação/deduplicação)', () => {
  test('9: mesmo job com 3 sinais de falha vira UM incidente (correlação por incidentType+entityType+entityId)', async () => {
    const signals = [
      signal({ detectedAt: '2026-01-01T00:00:00.000Z' }),
      signal({ detectedAt: '2026-01-01T00:05:00.000Z' }),
      signal({ detectedAt: '2026-01-01T00:10:00.000Z' }),
    ];

    const incidents = classifyIncidents(signals);
    assert.equal(incidents.length, 1, 'não deveria virar três incidentes independentes para o mesmo problema');
    assert.equal(incidents[0]!.signals.length, 3);
    assert.equal(incidents[0]!.detectedAt, '2026-01-01T00:10:00.000Z', 'usa o sinal mais recente');
  });

  test('10: entidade diferente produz incidente independente', () => {
    const signals = [signal({ entityId: '1' }), signal({ entityId: '2' })];

    const incidents = classifyIncidents(signals);
    assert.equal(incidents.length, 2);
  });

  test('7: severity correta para warning (nenhum sinal crítico no grupo)', () => {
    const incidents = classifyIncidents([signal({ type: 'run_stuck', severity: 'warning', entityType: 'agent_job_run', entityId: '9' })]);
    assert.equal(incidents[0]!.severity, 'warning');
  });

  test('8: severity correta para critical (o mais severo do grupo vence)', () => {
    const incidents = classifyIncidents([
      signal({ severity: 'warning', detectedAt: '2026-01-01T00:00:00.000Z' }),
      signal({ severity: 'critical', detectedAt: '2026-01-01T00:01:00.000Z' }),
    ]);
    assert.equal(incidents[0]!.severity, 'critical');
  });

  test('estado saudável (nenhum sinal) não gera incidente', () => {
    assert.deepEqual(classifyIncidents([]), []);
  });

  test('mapeamento signal type → incident type documentado é aplicado corretamente', () => {
    const incidents = classifyIncidents([signal({ type: 'workflow_stale', entityType: 'executive_review', entityId: '5' })]);
    assert.equal(incidents[0]!.type, 'recovery_required');

    const manualAttention = classifyIncidents([signal({ type: 'manual_attention_pending', entityType: 'agent_director_decision', entityId: '7' })]);
    assert.equal(manualAttention[0]!.type, 'manual_attention_required');

    const degradation = classifyIncidents([signal({ type: 'autonomy_disabled_globally', entityType: 'agent_global_autonomy', entityId: 'global' })]);
    assert.equal(degradation[0]!.type, 'operational_degradation');
  });
});
