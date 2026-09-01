import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateFilters, validateFiltersAgainstEventType } from './filters.js';
import type { EventFilters } from './filters.js';

describe('Event filters (Agentes v1.4 — correio.md seções 6/21)', () => {
  const payload = { priority: 'critical', probability: 80, active: true, source: 'referral' };

  test('eq', () => {
    assert.equal(evaluateFilters({ priority: { eq: 'critical' } }, payload), true);
    assert.equal(evaluateFilters({ priority: { eq: 'low' } }, payload), false);
  });

  test('neq', () => {
    assert.equal(evaluateFilters({ priority: { neq: 'low' } }, payload), true);
    assert.equal(evaluateFilters({ priority: { neq: 'critical' } }, payload), false);
  });

  test('in', () => {
    assert.equal(evaluateFilters({ priority: { in: ['high', 'critical'] } }, payload), true);
    assert.equal(evaluateFilters({ priority: { in: ['low', 'normal'] } }, payload), false);
  });

  test('not_in', () => {
    assert.equal(evaluateFilters({ priority: { not_in: ['low', 'normal'] } }, payload), true);
    assert.equal(evaluateFilters({ priority: { not_in: ['critical'] } }, payload), false);
  });

  test('gt/gte/lt/lte', () => {
    assert.equal(evaluateFilters({ probability: { gt: 70 } }, payload), true);
    assert.equal(evaluateFilters({ probability: { gt: 80 } }, payload), false);
    assert.equal(evaluateFilters({ probability: { gte: 80 } }, payload), true);
    assert.equal(evaluateFilters({ probability: { lt: 90 } }, payload), true);
    assert.equal(evaluateFilters({ probability: { lte: 80 } }, payload), true);
    assert.equal(evaluateFilters({ probability: { lte: 79 } }, payload), false);
  });

  test('exists', () => {
    assert.equal(evaluateFilters({ priority: { exists: true } }, payload), true);
    assert.equal(evaluateFilters({ missingField: { exists: true } }, payload), false);
    assert.equal(evaluateFilters({ missingField: { exists: false } }, payload), true);
  });

  test('múltiplos campos: todos precisam casar (AND implícito)', () => {
    assert.equal(evaluateFilters({ priority: { eq: 'critical' }, probability: { gte: 80 } }, payload), true);
    assert.equal(evaluateFilters({ priority: { eq: 'critical' }, probability: { gte: 90 } }, payload), false);
  });

  test('tipo incompatível (gt em campo string) nunca lança — retorna false', () => {
    assert.doesNotThrow(() => evaluateFilters({ priority: { gt: 5 } }, payload));
    assert.equal(evaluateFilters({ priority: { gt: 5 } }, payload), false);
  });

  test('validateFiltersAgainstEventType: rejeita campo não filterable', () => {
    const errors = validateFiltersAgainstEventType('crm.lead.created', {
      name: { eq: 'x' },
    } as unknown as EventFilters);
    assert.ok(errors.some((error) => error.field === 'name'));
  });

  test('validateFiltersAgainstEventType: rejeita event_type inexistente', () => {
    const errors = validateFiltersAgainstEventType('crm.lead.deleted', {} as EventFilters);
    assert.equal(errors.length, 1);
  });

  test('validateFiltersAgainstEventType: rejeita valor de tipo incompatível com o campo', () => {
    const errors = validateFiltersAgainstEventType('crm.lead.created', {
      probability: { eq: 'oitenta' },
    } as unknown as EventFilters);
    assert.ok(errors.length > 0);
  });

  test('validateFiltersAgainstEventType: aceita filtro válido', () => {
    const errors = validateFiltersAgainstEventType('crm.lead.created', {
      probability: { gte: 70 },
    } as unknown as EventFilters);
    assert.equal(errors.length, 0);
  });
});
