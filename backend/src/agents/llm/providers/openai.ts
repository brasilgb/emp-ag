import { env } from '../../../config/env.js';
import { ProviderHttpError, sanitizeProviderMessage } from '../error-classification.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../types.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

interface OpenAIResponsePayload {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Provider OpenAI via fetch puro contra a Responses API
 * (POST /v1/responses) — sem SDK (mesmo racional do GeminiProvider,
 * seção 4: "não espalhar SDK do provider pelo sistema"; aqui não há SDK
 * nenhum, só uma chamada HTTP encapsulada neste arquivo).
 *
 * Usa `text.format: { type: 'json_object' }` (JSON mode "solto", mesmo
 * nível de garantia do `responseMimeType: application/json` do Gemini) em
 * vez de `json_schema` — testado ao vivo (smoke test em shadow mode) e
 * confirmado: a Responses API exige `additionalProperties: false` em
 * TODO objeto aninhado do schema, inclusive dentro de `arguments`
 * (`In context=('properties', 'arguments'), 'additionalProperties' is
 * required to be supplied and to be false`) — mas `arguments` é
 * justamente o campo com shape arbitrária por tool (seção 8), então não
 * há um json_schema válido que o represente sem travar as chaves
 * possíveis. `json_object` garante JSON sintaticamente válido (por isso
 * o prompt em prompt.ts já pede explicitamente "responda com um objeto
 * JSON válido" — a OpenAI exige a palavra "json" nas instructions/input
 * pra esse modo) sem essa limitação de shape. A validação de verdade
 * continua sendo sempre o Zod schema em llm/schema.ts, nunca esta
 * chamada isolada (seção 6) — o mesmo vale para Gemini.
 *
 * Sem timeout próprio de propósito, igual ao GeminiProvider: quem corre
 * a chamada contra AGENT_LLM_TIMEOUT_MS é sempre o orquestrador
 * (raceWithTimeout em llm/interpreter.ts) — nenhum provider implementa
 * timeout duas vezes.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY não configurada.');
    }

    // Roles de LLMContextMessage já são 'user' | 'assistant' — a
    // Responses API aceita esses valores diretamente, sem remapeamento
    // (diferente do Gemini, que usa 'model' em vez de 'assistant').
    //
    // O item 'developer' com "json" é obrigatório para usar
    // text.format:'json_object' — confirmado em smoke test real: a API
    // rejeita com "Response input messages must contain the word 'json'
    // in some form" se só `instructions` (que já teria a palavra, seção
    // 25) mencionar JSON; o requisito é especificamente sobre `input`.
    const input = [
      { role: 'developer' as const, content: 'Responda sempre em formato JSON.' },
      ...request.contextMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      { role: 'user' as const, content: request.userMessage },
    ];

    const response = await fetch(`${OPENAI_API_BASE}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Só aqui — nunca no corpo, nunca logada (seção 30-bis).
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AGENT_LLM_MODEL,
        instructions: request.systemPrompt,
        input,
        // Sem `temperature`: confirmado em smoke test real que modelos de
        // raciocínio (a família usada aqui) rejeitam esse parâmetro
        // ("Unsupported parameter: 'temperature' is not supported with
        // this model") — diferente do GeminiProvider, que fixa
        // temperature=0 sem problema. Determinismo aqui vem só do prompt
        // (seção 25), não de um parâmetro de sampling.
        text: {
          format: { type: 'json_object' },
        },
      }),
    });

    if (!response.ok) {
      // Nunca incluir a API key (só vai no header, nunca no corpo/erro) —
      // sanitizeProviderMessage() redige defensivamente mesmo assim.
      // ProviderHttpError carrega o statusCode separado, para
      // interpreter.ts classificar como 'provider_http_error' sem
      // adivinhar a partir da mensagem (seção 30-bis) — mesma taxonomia
      // já usada pelo GeminiProvider.
      const body = await response.text().catch(() => '');
      const message = sanitizeProviderMessage(
        body || `OpenAI respondeu ${response.status} sem corpo.`,
        env.OPENAI_API_KEY,
      );
      throw new ProviderHttpError(response.status, message);
    }

    const payload = (await response.json()) as OpenAIResponsePayload;

    // `output` é uma lista de itens (pode incluir raciocínio, chamadas de
    // ferramenta etc.) — procura o item de mensagem do assistente e, nele,
    // a parte de texto de saída. Nunca confia num campo de conveniência
    // agregado (`output_text`) que só existe nos SDKs oficiais, não no
    // corpo bruto da REST API (fetch puro, seção 4).
    const text =
      payload.output
        ?.find((item) => item.type === 'message')
        ?.content?.find((part) => part.type === 'output_text')?.text ?? '';

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
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
      },
    };
  }
}
