import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentTools, agents } from '../../db/schema/index.js';
import { getTool } from '../tool-registry.js';
import { buildToolCatalogueForLLM } from './catalogue.js';
import { ProviderHttpError, sanitizeProviderMessage } from './error-classification.js';
import type { InterpretationErrorType } from './error-classification.js';
import { buildContextMessages, buildSystemPrompt } from './prompt.js';
import { llmInterpretationSchema } from './schema.js';
import type { LLMProvider, LLMUsage } from './types.js';

export type LLMInterpretationStatus =
  | 'ok'
  | 'clarification'
  | 'unknown'
  | 'invalid_tool'
  | 'invalid_agent'
  | 'invalid_arguments'
  | 'timeout'
  | 'provider_error'
  | 'invalid_output';

export interface LLMInterpretationResult {
  status: LLMInterpretationStatus;
  agent: string | null;
  tool: string | null;
  arguments: Record<string, unknown>;
  confidence: number | null;
  clarificationQuestion?: string;
  latencyMs: number;
  provider: string;
  model: string;
  usage?: LLMUsage;
  errorMessage?: string;
  // Classificação curta (seção 30-bis) — sempre que status não é um 'ok'
  // com confiança suficiente nem um 'unknown' legítimo, errorType diz o
  // porquê usando a taxonomia fixa de error-classification.ts. Persistido
  // sanitizado em agent_interpretations.error por shadow.ts, nunca aqui
  // (este módulo não sabe nada sobre persistência).
  errorType?: InterpretationErrorType;
  // Só preenchido quando errorType === 'provider_http_error'.
  statusCode?: number;
}

function isErrorStatus(status: LLMInterpretationStatus): boolean {
  return status === 'timeout' || status === 'provider_error' || status === 'invalid_output';
}

type RaceResult<T> = { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

// Corre a promise do provider contra um timeout, SEM nunca deixar uma
// rejeição escapar como exceção não tratada — tanto timeout quanto erro
// do provider viram um resultado normal (seção 13: falha do LLM nunca
// pode derrubar o chat).
async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<RaceResult<T>> {
  let timer: NodeJS.Timeout;

  const timeout = new Promise<RaceResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
  });

  const wrapped = promise
    .then((value): RaceResult<T> => ({ kind: 'value', value }))
    .catch((error): RaceResult<T> => ({ kind: 'error', error }));

  const result = await Promise.race([wrapped, timeout]);

  clearTimeout(timer!);
  return result;
}

/**
 * Orquestra uma interpretação via LLM: monta catálogo/prompt/contexto,
 * chama o provider com timeout, valida a saída estruturalmente (schema
 * Zod + existência real de agent/tool + tipos de argumentos — seção 9:
 * nunca aceitar tool inventada, mesmo com confidence 1.0). Não sabe nada
 * sobre shadow/fallback nem sobre autorização de usuário/agente — isso é
 * responsabilidade de llm/shadow.ts e do executeTool() da v1,
 * respectivamente (dupla autorização nunca é pulada, seção 16).
 */
export async function interpretWithLLM(params: {
  provider: LLMProvider;
  model: string;
  userMessage: string;
  conversationId: number;
  timeoutMs: number;
  // Só usado para classificar errorType: 'low_confidence' no resultado
  // 'ok' — nunca muda o resultado em si (a decisão do que fazer com
  // confiança baixa continua inteiramente em shadow.ts, seção 17).
  minConfidence: number;
}): Promise<LLMInterpretationResult> {
  const started = Date.now();

  const [toolCatalogue, contextMessages] = await Promise.all([
    buildToolCatalogueForLLM(),
    buildContextMessages(params.conversationId),
  ]);

  const systemPrompt = buildSystemPrompt(toolCatalogue);

  const base = {
    latencyMs: 0,
    provider: params.provider.name,
    model: params.model,
  };

  const raced = await raceWithTimeout(
    params.provider.complete({
      systemPrompt,
      userMessage: params.userMessage,
      contextMessages,
      toolCatalogue,
    }),
    params.timeoutMs,
  );

  const latencyMs = Date.now() - started;

  if (raced.kind === 'timeout') {
    return {
      ...base,
      status: 'timeout',
      agent: null,
      tool: null,
      arguments: {},
      confidence: null,
      latencyMs,
      errorType: 'timeout',
      errorMessage: `Timeout após ${params.timeoutMs}ms.`,
    };
  }

  if (raced.kind === 'error') {
    // ProviderHttpError (statusCode + mensagem já sanitizada por
    // GeminiProvider) vira 'provider_http_error' com o statusCode
    // preservado; qualquer outra falha de invocação (rede, API key
    // ausente etc., sem status HTTP nenhum) vira o genérico
    // 'provider_error'. sanitizeProviderMessage() aqui é só uma segunda
    // camada de defesa — a sanitização de verdade do corpo HTTP já
    // aconteceu na origem, em gemini.ts.
    if (raced.error instanceof ProviderHttpError) {
      return {
        ...base,
        status: 'provider_error',
        agent: null,
        tool: null,
        arguments: {},
        confidence: null,
        latencyMs,
        errorType: 'provider_http_error',
        statusCode: raced.error.statusCode,
        errorMessage: sanitizeProviderMessage(raced.error.message),
      };
    }

    const message = raced.error instanceof Error ? raced.error.message : 'Falha ao chamar o provider de LLM.';

    return {
      ...base,
      status: 'provider_error',
      agent: null,
      tool: null,
      arguments: {},
      confidence: null,
      latencyMs,
      errorType: 'provider_error',
      errorMessage: sanitizeProviderMessage(message),
    };
  }

  const response = raced.value;

  const parsed = llmInterpretationSchema.safeParse(response.raw);

  if (!parsed.success) {
    // response.rawParseFailed distingue os dois lados de 'invalid_output'
    // (seção 30-bis): texto que nem chegou a ser JSON válido
    // (invalid_json) de JSON válido que não bate com o schema esperado
    // (schema_validation_error) — nunca adivinhado a partir do tipo de
    // `raw` (um `raw` string também é o resultado normal de um
    // JSON.parse bem-sucedido de um literal de string).
    return {
      ...base,
      status: 'invalid_output',
      agent: null,
      tool: null,
      arguments: {},
      confidence: null,
      latencyMs,
      usage: response.usage,
      errorType: response.rawParseFailed ? 'invalid_json' : 'schema_validation_error',
      errorMessage: sanitizeProviderMessage(
        parsed.error.issues[0]?.message ?? 'Saída do modelo não corresponde ao schema esperado.',
      ),
    };
  }

  const data = parsed.data;

  if (data.clarificationRequired) {
    return {
      ...base,
      status: 'clarification',
      agent: data.agent ?? null,
      tool: null,
      arguments: {},
      confidence: data.confidence,
      clarificationQuestion: data.clarificationQuestion,
      latencyMs,
      usage: response.usage,
      errorType: 'clarification',
      errorMessage: data.clarificationQuestion
        ? sanitizeProviderMessage(`Modelo pediu esclarecimento: ${data.clarificationQuestion}`)
        : 'Modelo pediu esclarecimento.',
    };
  }

  if (!data.tool) {
    return {
      ...base,
      status: 'unknown',
      agent: data.agent ?? null,
      tool: null,
      arguments: {},
      confidence: data.confidence,
      latencyMs,
      usage: response.usage,
    };
  }

  // Seção 9: tool inventada nunca é aceita, mesmo com confidence alto —
  // precisa existir tanto no catálogo em código (registry) quanto na
  // tabela agent_tools ativa.
  const [dbTool] = await db
    .select()
    .from(agentTools)
    .where(and(eq(agentTools.handler, data.tool), eq(agentTools.isActive, true)))
    .limit(1);

  const registryEntry = getTool(data.tool);

  if (!dbTool || !registryEntry) {
    return {
      ...base,
      status: 'invalid_tool',
      agent: data.agent ?? null,
      tool: data.tool,
      arguments: data.arguments,
      confidence: data.confidence,
      latencyMs,
      usage: response.usage,
      errorType: 'invalid_tool',
      errorMessage: `Tool inexistente ou inativa: ${data.tool}`,
    };
  }

  const claimedAgent = data.agent ?? dbTool.department;

  const [agentRow] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, claimedAgent), eq(agents.isActive, true), eq(agents.status, 'active')))
    .limit(1);

  if (!agentRow) {
    return {
      ...base,
      status: 'invalid_agent',
      agent: claimedAgent,
      tool: data.tool,
      arguments: data.arguments,
      confidence: data.confidence,
      latencyMs,
      usage: response.usage,
      errorType: 'invalid_agent',
      errorMessage: `Agente inexistente ou inativo: ${claimedAgent}`,
    };
  }

  // Argumentos SEMPRE revalidados pelo schema Zod REAL da tool — nunca
  // pelo schema simplificado que foi mostrado ao modelo (seção 51 da v1,
  // reforçada aqui).
  const validatedArguments = registryEntry.inputSchema.safeParse(data.arguments);

  if (!validatedArguments.success) {
    return {
      ...base,
      status: 'invalid_arguments',
      agent: claimedAgent,
      tool: data.tool,
      arguments: data.arguments,
      confidence: data.confidence,
      latencyMs,
      usage: response.usage,
      errorType: 'invalid_arguments',
      errorMessage: validatedArguments.error.issues[0]?.message ?? 'Argumentos inválidos para esta ferramenta.',
    };
  }

  // 'ok' estruturalmente válido ainda pode ter confidence abaixo do
  // mínimo configurado — errorType: 'low_confidence' só classifica isso
  // para observabilidade (seção 26/30-bis); nunca muda o resultado (tool/
  // arguments continuam presentes, matched continua calculado
  // normalmente) nem a decisão de execução, que é sempre de shadow.ts.
  const lowConfidence = data.confidence !== null && data.confidence < params.minConfidence;

  return {
    ...base,
    status: 'ok',
    agent: claimedAgent,
    tool: data.tool,
    arguments: validatedArguments.data as Record<string, unknown>,
    confidence: data.confidence,
    latencyMs,
    usage: response.usage,
    ...(lowConfidence
      ? {
          errorType: 'low_confidence' as const,
          errorMessage: `Confiança (${data.confidence}) abaixo do mínimo configurado (${params.minConfidence}).`,
        }
      : {}),
  };
}

export { isErrorStatus };
