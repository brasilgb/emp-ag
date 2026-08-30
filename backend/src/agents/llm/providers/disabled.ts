import type { LLMProvider, LLMRequest, LLMResponse } from '../types.js';

// Guarda de segurança: só é usado se algo chamar getLLMProvider() sem
// checar env.AGENT_LLM_ENABLED antes (interpreter.ts sempre checa —
// nunca deveria chegar aqui em produção).
export class DisabledLLMProvider implements LLMProvider {
  readonly name = 'disabled';

  async complete(_request: LLMRequest): Promise<LLMResponse> {
    throw new Error('LLM desabilitado (AGENT_LLM_ENABLED=false) — provider não deveria ser chamado.');
  }
}
