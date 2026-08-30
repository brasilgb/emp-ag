import { env } from '../../../config/env.js';
import { ProviderHttpError, sanitizeProviderMessage } from '../error-classification.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../types.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Provider Gemini via fetch puro contra a REST API — sem SDK (seção 4:
 * "não espalhar SDK do provider pelo sistema"; aqui não há SDK nenhum, só
 * uma chamada HTTP encapsulada neste arquivo). Usa
 * `responseMimeType: application/json` (JSON mode nativo do Gemini) para
 * reduzir a chance de saída em markdown/texto livre — mas a validação de
 * verdade continua sendo o Zod schema em llm/schema.ts, nunca esta
 * chamada isolada (seção 6: nunca confiar em JSON só porque veio do
 * modelo).
 */
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!env.AGENT_LLM_API_KEY) {
      throw new Error('AGENT_LLM_API_KEY não configurada.');
    }

    const contents = [
      ...request.contextMessages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      { role: 'user', parts: [{ text: request.userMessage }] },
    ];

    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(env.AGENT_LLM_MODEL)}:generateContent`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.AGENT_LLM_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.systemPrompt }] },
        contents,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      }),
    });

    if (!response.ok) {
      // Nunca incluir a API key (só vai no header, nunca no corpo/erro) —
      // sanitizeProviderMessage() redige defensivamente mesmo assim.
      // ProviderHttpError carrega o statusCode separado, para
      // interpreter.ts classificar como 'provider_http_error' sem
      // adivinhar a partir da mensagem (seção 30-bis).
      const body = await response.text().catch(() => '');
      const message = sanitizeProviderMessage(
        body || `Gemini respondeu ${response.status} sem corpo.`,
        env.AGENT_LLM_API_KEY,
      );
      throw new ProviderHttpError(response.status, message);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let raw: unknown;
    let rawParseFailed = false;

    try {
      raw = JSON.parse(text);
    } catch {
      // Devolve o texto cru para o interpreter classificar como
      // invalid_json — nunca lança aqui, a decisão de como tratar é do
      // interpreter.
      raw = text;
      rawParseFailed = true;
    }

    return {
      raw,
      rawParseFailed,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount,
        outputTokens: payload.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
