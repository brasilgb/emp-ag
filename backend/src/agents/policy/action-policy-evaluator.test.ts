import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateAction } from './action-policy-evaluator.js';
import type { ActionPolicyInput, ActionPolicyToolInfo } from './action-policy-evaluator.js';

/*
 * Testes unitários do Action Policy Evaluator (correio.md v1.2 seção 3) —
 * função pura, sem banco/HTTP. Cobre a lista mínima da seção 15: read
 * autorizado, read sem permission, high risk sempre approval, e os casos
 * adicionais de shadow mode/baixo confidence que a seção 3/11 exigem.
 */

const DEFAULT_MIN_CONFIDENCE = 0.8;

function tool(overrides: Partial<ActionPolicyToolInfo> = {}): ActionPolicyToolInfo {
  return {
    requiredPermission: 'finance.read',
    autonomyLevel: 'read',
    isSensitive: false,
    risk: 'read',
    mutatesData: false,
    requiresApproval: false,
    ...overrides,
  };
}

function input(overrides: Partial<ActionPolicyInput> = {}): ActionPolicyInput {
  return {
    tool: tool(),
    userPermissions: new Set(['finance.read']),
    requiresApprovalOverride: false,
    shadowModeActive: false,
    confidence: DEFAULT_MIN_CONFIDENCE,
    ...overrides,
  };
}

describe('Action Policy Evaluator', () => {
  test('read com permission → execute', () => {
    const decision = evaluateAction(input());

    assert.deepEqual(decision, { decision: 'execute' });
  });

  test('read sem permission do usuário → blocked', () => {
    const decision = evaluateAction(input({ userPermissions: new Set([]) }));

    assert.equal(decision.decision, 'blocked');
  });

  test('risco high → approval_required sempre, mesmo com permission e confidence alta', () => {
    const decision = evaluateAction(
      input({
        tool: tool({ risk: 'high', mutatesData: true, requiredPermission: 'financial.delete' }),
        userPermissions: new Set(['financial.delete']),
        confidence: 1,
      }),
    );

    assert.equal(decision.decision, 'approval_required');
  });

  test('tool.requiresApproval=true força approval mesmo em risco medium', () => {
    const decision = evaluateAction(
      input({
        tool: tool({ risk: 'medium', mutatesData: true, requiresApproval: true }),
        confidence: 1,
      }),
    );

    assert.equal(decision.decision, 'approval_required');
  });

  test('override de agente↔tool força approval mesmo em risco low', () => {
    const decision = evaluateAction(
      input({
        tool: tool({ risk: 'low', mutatesData: true }),
        requiresApprovalOverride: true,
        confidence: 1,
      }),
    );

    assert.equal(decision.decision, 'approval_required');
  });

  test('confidence abaixo do mínimo → shadow, mesmo com permission e risco read', () => {
    const decision = evaluateAction(input({ confidence: 0.1 }));

    assert.deepEqual(decision, {
      decision: 'shadow',
      reason: 'Confiança (0.1) abaixo do mínimo configurado (0.8).',
    });
  });

  test('Shadow Mode ativo + tool muta dados → shadow, mesmo com permission e confidence alta', () => {
    const decision = evaluateAction(
      input({
        tool: tool({ risk: 'low', mutatesData: true }),
        shadowModeActive: true,
        confidence: 1,
      }),
    );

    assert.equal(decision.decision, 'shadow');
  });

  test('Shadow Mode ativo mas tool read-only (não muta) → executa normalmente', () => {
    const decision = evaluateAction(
      input({
        tool: tool({ risk: 'read', mutatesData: false }),
        shadowModeActive: true,
        confidence: 1,
      }),
    );

    assert.deepEqual(decision, { decision: 'execute' });
  });

  test('risco low/medium sem exigência explícita e autonomy_level != approval_required → execute', () => {
    const decision = evaluateAction(
      input({
        tool: tool({ risk: 'medium', mutatesData: true, autonomyLevel: 'execute' }),
        confidence: 1,
      }),
    );

    assert.deepEqual(decision, { decision: 'execute' });
  });

  test('autonomy_level=approval_required no fallback → approval_required', () => {
    const decision = evaluateAction(
      input({
        tool: tool({ risk: 'medium', mutatesData: true, autonomyLevel: 'approval_required' }),
        confidence: 1,
      }),
    );

    assert.equal(decision.decision, 'approval_required');
  });
});
