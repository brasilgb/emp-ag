import { env } from '../../config/env.js';
import { DisabledLLMProvider } from './providers/disabled.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';
import type { LLMProvider } from './types.js';

// Preparado para futuramente aceitar 'ollama' (seção 4) atrás da mesma
// interface — gemini/openai já têm chamada real implementada.
const PROVIDERS: Record<string, () => LLMProvider> = {
  gemini: () => new GeminiProvider(),
  openai: () => new OpenAIProvider(),
};

let testOverride: LLMProvider | null = null;

// Escape hatch só para testes (mesmo padrão de
// tool-registry.ts:clearRegistryForTests) — injeta um provider mockado
// sem precisar de uma API key real.
export function setLLMProviderOverrideForTests(provider: LLMProvider | null): void {
  testOverride = provider;
}

export function getLLMProvider(): LLMProvider {
  if (testOverride) {
    return testOverride;
  }

  const factory = PROVIDERS[env.AGENT_LLM_PROVIDER];

  if (!factory) {
    return new DisabledLLMProvider();
  }

  return factory();
}
