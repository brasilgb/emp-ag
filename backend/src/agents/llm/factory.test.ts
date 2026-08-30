import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { DisabledLLMProvider } from './providers/disabled.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';
import { getLLMProvider, setLLMProviderOverrideForTests } from './factory.js';

describe('getLLMProvider() — seleção de provider (gemini/openai/disabled)', () => {
  afterEach(() => {
    delete process.env.AGENT_LLM_PROVIDER;
    setLLMProviderOverrideForTests(null);
  });

  test('AGENT_LLM_PROVIDER=gemini (ou ausente) retorna GeminiProvider', () => {
    delete process.env.AGENT_LLM_PROVIDER;
    assert.ok(getLLMProvider() instanceof GeminiProvider);

    process.env.AGENT_LLM_PROVIDER = 'gemini';
    assert.ok(getLLMProvider() instanceof GeminiProvider);
  });

  test('AGENT_LLM_PROVIDER=openai retorna OpenAIProvider', () => {
    process.env.AGENT_LLM_PROVIDER = 'openai';
    assert.ok(getLLMProvider() instanceof OpenAIProvider);
  });

  test('AGENT_LLM_PROVIDER desconhecido retorna DisabledLLMProvider (guarda de segurança)', () => {
    process.env.AGENT_LLM_PROVIDER = 'nao-existe';
    assert.ok(getLLMProvider() instanceof DisabledLLMProvider);
  });

  test('setLLMProviderOverrideForTests tem precedência sobre AGENT_LLM_PROVIDER', () => {
    process.env.AGENT_LLM_PROVIDER = 'openai';
    const fake = { name: 'fake', complete: async () => ({ raw: {} }) };
    setLLMProviderOverrideForTests(fake);

    assert.equal(getLLMProvider(), fake);
  });
});
