import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeBreachRate, computeMean, computeMedian } from './sla-analytics-service.js';

/**
 * Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
 * Visibility", "19. Testes backend — Agregação pura") — funções puras,
 * sem banco, cobrindo exatamente os casos obrigatórios da seção 8.
 */
describe('Agentes v4.2 - sla-analytics-service (agregação pura)', () => {
  describe('computeMean', () => {
    test('1: [] → null (média sem valores)', () => {
      assert.equal(computeMean([]), null);
    });

    test('2: [10] → 10', () => {
      assert.equal(computeMean([10]), 10);
    });

    test('3: [10, 20] → 15', () => {
      assert.equal(computeMean([10, 20]), 15);
    });

    test('4: [10, 20, 30] → 20', () => {
      assert.equal(computeMean([10, 20, 30]), 20);
    });

    test('5: arredondamento é sempre ao inteiro mais próximo (nunca fração silenciosa)', () => {
      assert.equal(computeMean([10, 21]), 16); // 15.5 → 16
      assert.equal(computeMean([10, 20, 21]), 17); // 17.0(repeating) → 17
    });
  });

  describe('computeMedian', () => {
    test('6: [] → null (mediana sem valores)', () => {
      assert.equal(computeMedian([]), null);
    });

    test('7: [10] → 10', () => {
      assert.equal(computeMedian([10]), 10);
    });

    test('8: [10, 20] → 15 (mediana par)', () => {
      assert.equal(computeMedian([10, 20]), 15);
    });

    test('9: [10, 20, 30] → 20 (mediana ímpar)', () => {
      assert.equal(computeMedian([10, 20, 30]), 20);
    });

    test('10: não assume entrada ordenada', () => {
      assert.equal(computeMedian([30, 10, 20]), 20);
      assert.equal(computeMedian([100, 1, 50, 2]), 26); // sorted [1,2,50,100] → (2+50)/2=26
    });

    test('11: outlier não distorce a mediana como distorceria a média', () => {
      const values = [10, 12, 11, 13, 1000];
      assert.equal(computeMedian(values), 12);
      assert.notEqual(computeMean(values), 12);
    });
  });

  describe('computeBreachRate', () => {
    test('12: denominador zero → null (nunca NaN/Infinity/0 arbitrário)', () => {
      assert.equal(computeBreachRate(0, 0), null);
    });

    test('13: 0 outside de N within → 0 (nenhuma violação)', () => {
      assert.equal(computeBreachRate(10, 0), 0);
    });

    test('14: 100% outside → 1', () => {
      assert.equal(computeBreachRate(0, 10), 1);
    });

    test('15: breach rate válido — proporção exata, sem arredondamento embutido', () => {
      assert.equal(computeBreachRate(3, 1), 0.25);
      assert.ok(!Number.isNaN(computeBreachRate(1, 3)));
      assert.ok(Number.isFinite(computeBreachRate(1, 3)!));
    });
  });
});
