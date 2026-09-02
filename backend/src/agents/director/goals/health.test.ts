import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeHealth, computeHealthFactors } from './health.js';

/*
 * Agentes v2.0 (correio.md seção 23) — health algorithm: deterministico,
 * testavel, `now` sempre controlado (nunca Date.now()/new Date() direto).
 */
const START = new Date('2026-01-01T00:00:00.000Z');
const TARGET = new Date('2026-01-11T00:00:00.000Z'); // 10 dias de prazo

describe('computeHealthFactors', () => {
  test('now controlado: timeElapsedPercent/deviation calculados sem Date.now() implícito', () => {
    const now = new Date('2026-01-06T00:00:00.000Z'); // 50% do prazo
    const factors = computeHealthFactors({ progressPercent: 50, startDate: START, targetDate: TARGET, now });
    assert.equal(factors.timeElapsedPercent, 50);
    assert.equal(factors.deviation, 0);
    assert.equal(factors.isOverdue, false);
  });

  test('prazo vencido marca isOverdue mesmo com progresso alto', () => {
    const now = new Date('2026-01-12T00:00:00.000Z');
    const factors = computeHealthFactors({ progressPercent: 90, startDate: START, targetDate: TARGET, now });
    assert.equal(factors.isOverdue, true);
  });

  test('timeElapsedPercent capado em 100 mesmo muito além do prazo', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const factors = computeHealthFactors({ progressPercent: 10, startDate: START, targetDate: TARGET, now });
    assert.equal(factors.timeElapsedPercent, 100);
  });
});

describe('computeHealth', () => {
  test('progresso igual ou à frente do tempo decorrido → on_track', () => {
    const now = new Date('2026-01-06T00:00:00.000Z'); // 50% do tempo
    const factors = computeHealthFactors({ progressPercent: 55, startDate: START, targetDate: TARGET, now });
    assert.equal(computeHealth(factors, false), 'on_track');
  });

  test('deviation exatamente no limiar (-10) ainda é on_track (limiar inclusivo)', () => {
    const now = new Date('2026-01-06T00:00:00.000Z'); // 50%
    const factors = computeHealthFactors({ progressPercent: 40, startDate: START, targetDate: TARGET, now }); // deviation -10
    assert.equal(computeHealth(factors, false), 'on_track');
  });

  test('pequeno desvio (-11 a -25) → attention', () => {
    const now = new Date('2026-01-06T00:00:00.000Z'); // 50%
    const factors = computeHealthFactors({ progressPercent: 39, startDate: START, targetDate: TARGET, now }); // deviation -11
    assert.equal(computeHealth(factors, false), 'attention');
  });

  test('desvio relevante (-25 a -44) → at_risk', () => {
    const now = new Date('2026-01-06T00:00:00.000Z'); // 50%
    const factors = computeHealthFactors({ progressPercent: 20, startDate: START, targetDate: TARGET, now }); // deviation -30
    assert.equal(computeHealth(factors, false), 'at_risk');
  });

  test('desvio severo (<= -45) → critical', () => {
    const now = new Date('2026-01-06T00:00:00.000Z'); // 50%
    const factors = computeHealthFactors({ progressPercent: 0, startDate: START, targetDate: TARGET, now }); // deviation -50
    assert.equal(computeHealth(factors, false), 'critical');
  });

  test('prazo vencido sem conclusão nunca fica on_track/attention — no mínimo at_risk', () => {
    const now = new Date('2026-01-12T00:00:00.000Z'); // vencido
    const factors = computeHealthFactors({ progressPercent: 95, startDate: START, targetDate: TARGET, now }); // deviation pequeno
    assert.equal(computeHealth(factors, false), 'at_risk');
  });

  test('progresso completo (100%) é sempre on_track, mesmo vencido', () => {
    const now = new Date('2026-01-15T00:00:00.000Z');
    const factors = computeHealthFactors({ progressPercent: 100, startDate: START, targetDate: TARGET, now });
    assert.equal(computeHealth(factors, true), 'on_track');
  });
});
