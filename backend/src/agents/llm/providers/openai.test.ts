import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { ProviderHttpError } from '../error-classification.js';
import { OpenAIProvider } from './openai.js';

/*
 * Testes unitários do OpenAIProvider — sem rede real (global.fetch
 * sempre mockado), sem DB, sem custo. Cobre o contrato do Responses API
 * (montagem do payload + parsing da resposta) isolado do resto do LLM
 * Interpreter; a validação estrutural completa (Zod, invalid_tool etc.)
 * já é coberta por interpreter.test.ts com qualquer provider mockado —
 * aqui só interessa o que é específico da OpenAIProvider.
 */

const REQUEST = {
  systemPrompt: 'Você é um classificador de intenção.',
  userMessage: 'Quanto temos a receber?',
  contextMessages: [
    { role: 'user' as const, content: 'oi' },
    { role: 'assistant' as const, content: 'olá, como posso ajudar?' },
  ],
  toolCatalogue: [],
};

function mockFetchOnce(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const originalFetch = global.fetch;
  global.fetch = (async (url: string, init?: RequestInit) => handler(url, init)) as typeof fetch;
  return () => {
    global.fetch = originalFetch;
  };
}

describe('OpenAIProvider', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  test('lança erro claro quando OPENAI_API_KEY não está configurada', async () => {
    delete process.env.OPENAI_API_KEY;
    const provider = new OpenAIProvider();

    await assert.rejects(() => provider.complete(REQUEST), /OPENAI_API_KEY não configurada/);
  });

  test('monta o payload da Responses API: model, instructions, input e JSON mode', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const restore = mockFetchOnce((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    });

    try {
      process.env.AGENT_LLM_MODEL = 'gpt-5.6-luna';
      await new OpenAIProvider().complete(REQUEST);

      assert.equal(capturedUrl, 'https://api.openai.com/v1/responses');

      const body = JSON.parse(String(capturedInit?.body ?? '{}'));
      assert.equal(body.model, 'gpt-5.6-luna');
      assert.equal(body.instructions, REQUEST.systemPrompt);
      assert.deepEqual(body.input, [
        { role: 'developer', content: 'Responda sempre em formato JSON.' },
        { role: 'user', content: 'oi' },
        { role: 'assistant', content: 'olá, como posso ajudar?' },
        { role: 'user', content: REQUEST.userMessage },
      ]);
      // json_object exige a palavra "json" em algum item de `input` (não
      // basta em `instructions`) — confirmado em smoke test real.
      assert.match(JSON.stringify(body.input), /json/i);
      // json_object, não json_schema: 'arguments' tem shape arbitrária por
      // tool (seção 8) e a Responses API exige additionalProperties:false
      // em todo objeto aninhado do json_schema, inclusive dentro de
      // 'arguments' — confirmado em smoke test real
      // (in context=('properties','arguments'), 'additionalProperties' is
      // required to be supplied and to be false). json_object garante
      // JSON válido sem essa limitação de shape.
      assert.equal(body.text.format.type, 'json_object');
    } finally {
      restore();
      delete process.env.AGENT_LLM_MODEL;
    }
  });

  test('parseia output_text da Responses API para o objeto estruturado esperado', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';
    const structured = { agent: 'finance', tool: 'finance.get_summary', arguments: {}, confidence: 0.95 };

    const restore = mockFetchOnce(
      () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: JSON.stringify(structured) }],
              },
            ],
            usage: { input_tokens: 120, output_tokens: 18 },
          }),
          { status: 200 },
        ),
    );

    try {
      const result = await new OpenAIProvider().complete(REQUEST);

      assert.deepEqual(result.raw, structured);
      assert.equal(result.rawParseFailed, false);
      assert.equal(result.usage?.inputTokens, 120);
      assert.equal(result.usage?.outputTokens, 18);
    } finally {
      restore();
    }
  });

  test('texto de saída que não é JSON válido vira rawParseFailed=true (invalid_json)', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';

    const restore = mockFetchOnce(
      () =>
        new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'isso não é JSON' }],
              },
            ],
          }),
          { status: 200 },
        ),
    );

    try {
      const result = await new OpenAIProvider().complete(REQUEST);

      assert.equal(result.raw, 'isso não é JSON');
      assert.equal(result.rawParseFailed, true);
    } finally {
      restore();
    }
  });

  test('resposta sem item de mensagem (ex.: só reasoning) vira texto vazio, nunca lança', async () => {
    process.env.OPENAI_API_KEY = 'sk-teste';

    const restore = mockFetchOnce(
      () => new Response(JSON.stringify({ output: [{ type: 'reasoning', content: [] }] }), { status: 200 }),
    );

    try {
      const result = await new OpenAIProvider().complete(REQUEST);

      assert.equal(result.rawParseFailed, true);
    } finally {
      restore();
    }
  });

  test('HTTP não-ok vira ProviderHttpError com statusCode e mensagem sanitizada (sem API key)', async () => {
    const secretKey = `sk-secret-${Date.now()}`;
    process.env.OPENAI_API_KEY = secretKey;

    const restore = mockFetchOnce(
      () =>
        new Response(`{"error":{"message":"quota exceeded", "leaked_key":"${secretKey}"}}`, {
          status: 429,
        }),
    );

    try {
      await assert.rejects(
        () => new OpenAIProvider().complete(REQUEST),
        (error: unknown) => {
          assert.ok(error instanceof ProviderHttpError);
          assert.equal(error.statusCode, 429);
          assert.match(error.message, /quota exceeded/);
          assert.ok(!error.message.includes(secretKey), 'API key vazou na mensagem de erro.');
          return true;
        },
      );
    } finally {
      restore();
    }
  });

  test('API key só no header Authorization, nunca no corpo da requisição', async () => {
    const secretKey = `sk-secret-${Date.now()}`;
    process.env.OPENAI_API_KEY = secretKey;

    let capturedInit: RequestInit | undefined;
    const restore = mockFetchOnce((_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    });

    try {
      await new OpenAIProvider().complete(REQUEST);

      const bodyText = String(capturedInit?.body ?? '');
      assert.ok(!bodyText.includes(secretKey), 'API key vazou para o corpo da requisição.');

      const headers = capturedInit?.headers as Record<string, string>;
      assert.equal(headers.Authorization, `Bearer ${secretKey}`);
    } finally {
      restore();
    }
  });
});
