import { env } from '../../../config/env.js';
import { ProviderHttpError, sanitizeProviderMessage } from '../error-classification.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../types.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';

// Mesmo objeto pedido ao modelo nas duas metades do contrato (seção 6/7
// do LLM Interpreter) via Structured Output (JSON Schema) — mas a
// validação de verdade continua sendo o Zod schema em llm/schema.ts
// (nunca confiar em JSON só porque veio do modelo, nem porque um schema
// foi pedido). Não usa `strict: true`/`additionalProperties: false`: as
// tools do catálogo têm shapes de argumento arbitrárias e variadas
// (seção 8), incompatíveis com o "grammar-constrained" strict mode da
// OpenAI, que exige todo objeto com additionalProperties:false e toda
// chave presente em `required` — `arguments` precisa aceitar qualquer
// forma.
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    agent: { type: ['string', 'null'] },
    tool: { type: ['string', 'null'] },
    arguments: { type: 'object' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    clarificationRequired: { type: 'boolean' },
    clarificationQuestion: { type: 'string' },
  },
  required: ['agent', 'tool', 'arguments', 'confidence'],
};

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
 * nenhum, só uma chamada HTTP encapsulada neste arquivo). Usa Structured
 * Output (`text.format: json_schema`) pra reduzir a chance de saída fora
 * do formato esperado — mas a validação de verdade continua sendo o Zod
 * schema em llm/schema.ts, nunca esta chamada isolada (seção 6).
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
    const input = [
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
        temperature: 0,
        text: {
          format: {
            type: 'json_schema',
            name: 'llm_interpretation',
            schema: RESPONSE_JSON_SCHEMA,
          },
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
