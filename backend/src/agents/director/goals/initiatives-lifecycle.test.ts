import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AgentError } from '../../errors.js';

import { REOPENABLE_INITIATIVE_STATUSES } from './review-service.js';
import { assertInitiativeTransition, canTransitionInitiative } from './initiatives-lifecycle.js';
import { INITIATIVE_STATUSES, type InitiativeStatus } from './types.js';

/*
 * Agentes v2.1 (correio.md seção 1/19) — única fonte de verdade de
 * lifecycle de Initiative: toda transição válida/inválida da tabela do
 * correio.md, testada explicitamente (nunca "espalhada pelas rotas").
 */
const VALID_TRANSITIONS: [InitiativeStatus, InitiativeStatus][] = [
  ['proposed', 'approved'],
  ['proposed', 'cancelled'],
  ['approved', 'active'],
  ['approved', 'cancelled'],
  ['active', 'blocked'],
  ['active', 'completed'],
  ['active', 'cancelled'],
  ['blocked', 'active'],
  ['blocked', 'cancelled'],
  ['completed', 'proposed'],
  ['cancelled', 'proposed'],
];

describe('canTransitionInitiative / assertInitiativeTransition', () => {
  test('todas as transições da tabela do correio.md são permitidas', () => {
    for (const [from, to] of VALID_TRANSITIONS) {
      assert.equal(canTransitionInitiative(from, to), true, `${from} → ${to} deveria ser permitida`);
      assert.doesNotThrow(() => assertInitiativeTransition(from, to));
    }
  });

  test('toda transição fora da tabela é rejeitada — cobertura exaustiva de todos os pares possíveis', () => {
    const validSet = new Set(VALID_TRANSITIONS.map(([from, to]) => `${from}:${to}`));

    for (const from of INITIATIVE_STATUSES) {
      for (const to of INITIATIVE_STATUSES) {
        const shouldBeValid = validSet.has(`${from}:${to}`);
        assert.equal(canTransitionInitiative(from, to), shouldBeValid, `${from} → ${to}: esperado ${shouldBeValid}`);
      }
    }
  });

  test('transição inválida lança AgentError "conflict" (409)', () => {
    assert.throws(
      () => assertInitiativeTransition('proposed', 'active'),
      (error: unknown) => error instanceof AgentError && error.code === 'conflict' && error.status === 409,
    );
  });

  test('estado desconhecido (nunca confia em string solta vinda do banco) é sempre rejeitado, nunca lança TypeError', () => {
    assert.equal(canTransitionInitiative('nunca_existiu', 'proposed'), false);
    assert.doesNotThrow(() => {
      try {
        assertInitiativeTransition('nunca_existiu', 'proposed');
      } catch (error) {
        assert.ok(error instanceof AgentError);
      }
    });
  });

  test('nenhuma transição para o próprio estado (sem self-loop)', () => {
    for (const status of INITIATIVE_STATUSES) {
      assert.equal(canTransitionInitiative(status, status), false, `${status} → ${status} não deveria ser permitida`);
    }
  });

  test('consistência: REOPENABLE_INITIATIVE_STATUSES (review-service.ts) é EXATAMENTE o conjunto de origens de "→ proposed" aqui', () => {
    const sourcesToProposed = INITIATIVE_STATUSES.filter((status) => canTransitionInitiative(status, 'proposed'));
    assert.deepEqual([...sourcesToProposed].sort(), [...REOPENABLE_INITIATIVE_STATUSES].sort());
  });
});
