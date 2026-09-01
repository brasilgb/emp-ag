import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeNextRunAt } from './schedule.js';

describe('computeNextRunAt (Agentes v1.3 — correio.md seção 4)', () => {
  test('hourly: soma o intervalo em horas ao horário de referência', () => {
    const from = new Date('2026-01-01T10:15:00.000Z');
    const next = computeNextRunAt({ frequency: 'hourly', interval: 4 }, from);

    assert.equal(next.toISOString(), '2026-01-01T14:15:00.000Z');
  });

  test('daily: horário ainda não passou hoje → agenda para hoje', () => {
    const from = new Date('2026-01-01T05:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'daily', hour: 8, minute: 0 }, from);

    assert.equal(next.toISOString(), '2026-01-01T08:00:00.000Z');
  });

  test('daily: horário já passou hoje → agenda para amanhã', () => {
    const from = new Date('2026-01-01T09:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'daily', hour: 8, minute: 0 }, from);

    assert.equal(next.toISOString(), '2026-01-02T08:00:00.000Z');
  });

  test('daily: exatamente no horário configurado → conta como já passado, agenda para amanhã', () => {
    const from = new Date('2026-01-01T08:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'daily', hour: 8, minute: 0 }, from);

    assert.equal(next.toISOString(), '2026-01-02T08:00:00.000Z');
  });

  test('daily: atravessa virada de mês corretamente', () => {
    const from = new Date('2026-01-31T09:00:00.000Z');
    const next = computeNextRunAt({ frequency: 'daily', hour: 8, minute: 0 }, from);

    assert.equal(next.toISOString(), '2026-02-01T08:00:00.000Z');
  });
});
