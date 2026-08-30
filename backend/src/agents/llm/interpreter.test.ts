import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentConversations, agentMessages, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { registerAllTools } from '../tools/index.js';
import { GeminiProvider } from './providers/gemini.js';
import { OpenAIProvider } from './providers/openai.js';
import { buildContextMessages } from './prompt.js';
import { interpretWithLLM } from './interpreter.js';
import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';

const DEFAULT_MIN_CONFIDENCE = 0.8;

/*
 * Testes unitários do LLM Interpreter (seção 32, casos #3/4/5/6/7/9/10/17/18)
 * — sem HTTP, provider sempre mockado via injeção de dependência
 * (interpretWithLLM recebe o provider como parâmetro, nunca lê a factory
 * global). Casos end-to-end via /agents/chat ficam em
 * routes/agents/llm.test.ts.
 */

function mockProvider(impl: (request: LLMRequest) => Promise<LLMResponse> | LLMResponse): LLMProvider {
  return {
    name: 'mock',
    async complete(request) {
      return impl(request);
    },
  };
}

describe('LLM Interpreter (unitário)', () => {
  registerAllTools();

  let conversationId: number;
  const createdMessageIds: number[] = [];

  before(async () => {
    const [ceoUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, (process.env.CEO_EMAIL ?? '').toLowerCase()))
      .limit(1);

    assert.ok(ceoUser, 'Usuário CEO do seed não encontrado (rode npm run db:seed).');

    const [conversation] = await db
      .insert(agentConversations)
      .values({ userId: ceoUser.id, title: 'Teste LLM Interpreter' })
      .returning();

    conversationId = conversation.id;
  });

  after(async () => {
    await db.delete(agentConversations).where(eq(agentConversations.id, conversationId));
    await database.end();
    redis.disconnect();
  });

  // #3
  test('structured output válido é aceito', async () => {
    const provider = mockProvider(() => ({
      raw: { agent: 'finance', tool: 'finance.get_summary', arguments: {}, confidence: 0.92 },
    }));

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'Quanto temos a receber?',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.agent, 'finance');
    assert.equal(result.tool, 'finance.get_summary');
    assert.equal(result.confidence, 0.92);
    assert.equal(result.errorType, undefined, 'ok com confidence suficiente não deveria ter errorType.');
  });

  // #30-bis
  test('"ok" com confidence abaixo do mínimo configurado vira errorType: low_confidence', async () => {
    const provider = mockProvider(() => ({
      raw: { agent: 'finance', tool: 'finance.get_summary', arguments: {}, confidence: 0.4 },
    }));

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'Quanto temos a receber?',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    // low_confidence é só uma classificação — o resultado continua 'ok'
    // e tool/arguments continuam presentes (a decisão de não executar é
    // sempre de shadow.ts, seção 17).
    assert.equal(result.status, 'ok');
    assert.equal(result.tool, 'finance.get_summary');
    assert.equal(result.errorType, 'low_confidence');
    assert.match(result.errorMessage ?? '', /0\.4/);
  });

  // #4
  test('JSON que não bate com o schema vira invalid_output/schema_validation_error (raw já era um objeto)', async () => {
    // `raw` é um objeto (JSON.parse já teria funcionado no provider real)
    // mas não tem os campos esperados — schema_validation_error, não
    // invalid_json (o provider não sinalizou rawParseFailed).
    const provider = mockProvider(() => ({ raw: { foo: 'bar' } }));

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'qualquer coisa',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'invalid_output');
    assert.equal(result.tool, null);
    assert.equal(result.errorType, 'schema_validation_error');
  });

  // #4-bis
  test('texto que não é JSON válido vira invalid_output/invalid_json (rawParseFailed)', async () => {
    const provider = mockProvider(() => ({
      raw: 'isso não é um objeto JSON válido',
      rawParseFailed: true,
    }));

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'qualquer coisa',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'invalid_output');
    assert.equal(result.tool, null);
    assert.equal(result.errorType, 'invalid_json');
  });

  // #5
  test('tool inventada é rejeitada mesmo com confidence 1.0', async () => {
    const provider = mockProvider(() => ({
      raw: { agent: 'finance', tool: 'finance.delete_payment', arguments: {}, confidence: 1 },
    }));

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'apague o pagamento X',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'invalid_tool');
    assert.equal(result.errorType, 'invalid_tool');
  });

  // #6
  test('agent inválido é rejeitado mesmo com tool real', async () => {
    const provider = mockProvider(() => ({
      raw: { agent: 'nao_existe', tool: 'finance.get_summary', arguments: {}, confidence: 0.9 },
    }));

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'quanto temos a receber?',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'invalid_agent');
    assert.equal(result.errorType, 'invalid_agent');
  });

  // #7
  test('arguments inválidos (faltando campo obrigatório) são rejeitados', async () => {
    const provider = mockProvider(() => ({
      raw: {
        agent: 'finance',
        tool: 'finance.prepare_payment_reminder',
        arguments: {},
        confidence: 0.9,
      },
    }));

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'prepare um lembrete',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'invalid_arguments');
    assert.equal(result.errorType, 'invalid_arguments');
  });

  // #9
  test('timeout do provider é absorvido, nunca lança', async () => {
    const provider = mockProvider(
      () => new Promise<LLMResponse>((resolve) => setTimeout(() => resolve({ raw: {} }), 200)),
    );

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'qualquer coisa',
      conversationId,
      timeoutMs: 30,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'timeout');
    assert.equal(result.errorType, 'timeout');
  });

  // #10
  test('falha do provider é absorvida, nunca lança', async () => {
    const provider = mockProvider(() => {
      throw new Error('provider indisponível');
    });

    const result = await interpretWithLLM({
      provider,
      model: 'test-model',
      userMessage: 'qualquer coisa',
      conversationId,
      timeoutMs: 5000,
      minConfidence: DEFAULT_MIN_CONFIDENCE,
    });

    assert.equal(result.status, 'provider_error');
    assert.equal(result.errorType, 'provider_error');
    assert.match(result.errorMessage ?? '', /provider indisponível/);
  });

  // #30-bis
  test('ProviderHttpError (HTTP não-ok do Gemini) vira errorType: provider_http_error com statusCode', async () => {
    const originalFetch = global.fetch;

    global.fetch = (async () =>
      new Response('{"error":{"message":"quota exceeded"}}', { status: 429 })) as typeof fetch;
    process.env.AGENT_LLM_API_KEY = 'chave-de-teste';

    try {
      const result = await interpretWithLLM({
        provider: new GeminiProvider(),
        model: 'test-model',
        userMessage: 'qualquer coisa',
        conversationId,
        timeoutMs: 5000,
        minConfidence: DEFAULT_MIN_CONFIDENCE,
      });

      assert.equal(result.status, 'provider_error');
      assert.equal(result.errorType, 'provider_http_error');
      assert.equal(result.statusCode, 429);
      assert.match(result.errorMessage ?? '', /quota exceeded/);
      assert.ok(!(result.errorMessage ?? '').includes('chave-de-teste'), 'API key vazou na mensagem de erro.');
    } finally {
      global.fetch = originalFetch;
      delete process.env.AGENT_LLM_API_KEY;
    }
  });

  // #17
  test('API key nunca aparece no corpo da requisição, só no header', async () => {
    const secretMarker = `secret-key-${Date.now()}`;
    process.env.AGENT_LLM_API_KEY = secretMarker;

    const originalFetch = global.fetch;
    let capturedInit: RequestInit | undefined;

    global.fetch = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const provider = new GeminiProvider();
      await provider.complete({
        systemPrompt: 'sistema',
        userMessage: 'mensagem',
        contextMessages: [],
        toolCatalogue: [],
      });

      assert.ok(capturedInit, 'fetch não foi chamado.');
      const bodyText = String(capturedInit!.body ?? '');
      assert.ok(!bodyText.includes(secretMarker), 'API key vazou para o corpo da requisição.');

      const headers = capturedInit!.headers as Record<string, string>;
      assert.equal(headers['x-goog-api-key'], secretMarker, 'API key deveria ir só no header.');
    } finally {
      global.fetch = originalFetch;
      delete process.env.AGENT_LLM_API_KEY;
    }
  });

  // #30-bis — mesma cobertura acima, agora para OpenAIProvider, provando
  // que a integração via interpretWithLLM (não só o provider isolado, já
  // coberto em providers/openai.test.ts) segue a mesma taxonomia de erro.
  test('OpenAIProvider: ProviderHttpError (HTTP não-ok) vira errorType: provider_http_error com statusCode', async () => {
    const originalFetch = global.fetch;

    global.fetch = (async () =>
      new Response('{"error":{"message":"quota exceeded"}}', { status: 429 })) as typeof fetch;
    process.env.OPENAI_API_KEY = 'chave-de-teste';

    try {
      const result = await interpretWithLLM({
        provider: new OpenAIProvider(),
        model: 'test-model',
        userMessage: 'qualquer coisa',
        conversationId,
        timeoutMs: 5000,
        minConfidence: DEFAULT_MIN_CONFIDENCE,
      });

      assert.equal(result.status, 'provider_error');
      assert.equal(result.errorType, 'provider_http_error');
      assert.equal(result.statusCode, 429);
      assert.match(result.errorMessage ?? '', /quota exceeded/);
      assert.ok(!(result.errorMessage ?? '').includes('chave-de-teste'), 'API key vazou na mensagem de erro.');
    } finally {
      global.fetch = originalFetch;
      delete process.env.OPENAI_API_KEY;
    }
  });

  test('OpenAIProvider: API key nunca aparece no corpo da requisição, só no header Authorization', async () => {
    const secretMarker = `secret-key-${Date.now()}`;
    process.env.OPENAI_API_KEY = secretMarker;

    const originalFetch = global.fetch;
    let capturedInit: RequestInit | undefined;

    global.fetch = (async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ output: [] }), { status: 200 });
    }) as typeof fetch;

    try {
      const provider = new OpenAIProvider();
      await provider.complete({
        systemPrompt: 'sistema',
        userMessage: 'mensagem',
        contextMessages: [],
        toolCatalogue: [],
      });

      assert.ok(capturedInit, 'fetch não foi chamado.');
      const bodyText = String(capturedInit!.body ?? '');
      assert.ok(!bodyText.includes(secretMarker), 'API key vazou para o corpo da requisição.');

      const headers = capturedInit!.headers as Record<string, string>;
      assert.equal(headers.Authorization, `Bearer ${secretMarker}`, 'API key deveria ir só no header Authorization.');
    } finally {
      global.fetch = originalFetch;
      delete process.env.OPENAI_API_KEY;
    }
  });

  test('OpenAIProvider: structured output válido é aceito via interpretWithLLM (mesmo contrato do Gemini)', async () => {
    const originalFetch = global.fetch;

    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    agent: 'finance',
                    tool: 'finance.get_summary',
                    arguments: {},
                    confidence: 0.95,
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    process.env.OPENAI_API_KEY = 'chave-de-teste';

    try {
      const result = await interpretWithLLM({
        provider: new OpenAIProvider(),
        model: 'gpt-5.6-luna',
        userMessage: 'Quanto temos a receber?',
        conversationId,
        timeoutMs: 5000,
        minConfidence: DEFAULT_MIN_CONFIDENCE,
      });

      assert.equal(result.status, 'ok');
      assert.equal(result.agent, 'finance');
      assert.equal(result.tool, 'finance.get_summary');
      assert.equal(result.confidence, 0.95);
      assert.equal(result.errorType, undefined);
    } finally {
      global.fetch = originalFetch;
      delete process.env.OPENAI_API_KEY;
    }
  });

  // #18
  test('contexto respeita o limite configurável (AGENT_LLM_CONTEXT_MESSAGES)', async () => {
    process.env.AGENT_LLM_CONTEXT_MESSAGES = '3';

    try {
      const contents = ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'];

      for (const content of contents) {
        const [row] = await db
          .insert(agentMessages)
          .values({ conversationId, role: 'user', content })
          .returning();
        createdMessageIds.push(row.id);
      }

      const context = await buildContextMessages(conversationId);

      assert.equal(context.length, 3);
      assert.deepEqual(
        context.map((m) => m.content),
        ['msg-3', 'msg-4', 'msg-5'],
      );
    } finally {
      delete process.env.AGENT_LLM_CONTEXT_MESSAGES;

      for (const id of createdMessageIds) {
        await db.delete(agentMessages).where(eq(agentMessages.id, id));
      }
    }
  });
});
