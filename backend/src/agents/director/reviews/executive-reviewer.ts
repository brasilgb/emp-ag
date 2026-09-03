import { ProviderHttpError, sanitizeProviderMessage } from '../../llm/error-classification.js';
import type { InterpretationErrorType } from '../../llm/error-classification.js';
import type { LLMProvider, LLMUsage } from '../../llm/types.js';

import type { RelevantMemorySummary } from '../memory/context.js';

import type { ExecutiveReviewContext } from './context.js';
import { buildExecutiveReviewSystemPrompt, buildExecutiveReviewUserMessage } from './prompt.js';
import { executiveReviewOutputSchema } from './schemas.js';
import type { ExecutiveReviewOutput } from './schemas.js';

export type ExecutiveReviewerStatus = 'ok' | 'timeout' | 'provider_error' | 'invalid_output';

export interface ExecutiveReviewerResult {
  status: ExecutiveReviewerStatus;
  output: ExecutiveReviewOutput | null;
  latencyMs: number;
  provider: string;
  model: string;
  usage?: LLMUsage;
  errorType?: InterpretationErrorType;
  errorMessage?: string;
  statusCode?: number;
}

type RaceResult<T> = { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

// Cópia local do mesmo racional de planner/action-planner.ts:raceWithTimeout
// — nunca deixa uma rejeição do provider escapar como exceção não tratada,
// e nunca segura recurso nenhum (nenhuma transação Postgres envolvida aqui:
// este módulo só monta prompt/chama provider/valida saída, nunca toca o
// banco — correio.md seção 11: "nunca manter lock ou transaction Postgres
// aberta enquanto provider LLM... estiver sendo executado").
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
 * Executive Reviewer (correio.md seção 7) — recebe o contexto já
 * normalizado (`buildExecutiveReviewContext`), chama o provider LLM
 * oficial, valida a saída com Zod, devolve SOMENTE análise/recomendação.
 * Nunca executa ação nenhuma, nunca toca o banco (persistência é
 * responsabilidade exclusiva de `review-service.ts`, fora deste módulo)
 * — mesma separação de responsabilidade de `planner/action-planner.ts`
 * em relação a `orchestration/create-action-plan.ts`.
 */
export async function reviewExecutiveOutcome(params: {
  provider: LLMProvider;
  model: string;
  context: ExecutiveReviewContext;
  timeoutMs: number;
  // Agentes v2.3 (correio.md seção 11) — memórias estratégicas
  // relevantes já recuperadas por `getRelevantStrategicMemories`, nunca
  // buscadas por este módulo (que não toca o banco). Opcional/vazio por
  // padrão — retrocompatível com o comportamento da v2.2.
  historicalMemories?: RelevantMemorySummary[];
}): Promise<ExecutiveReviewerResult> {
  const started = Date.now();

  const systemPrompt = buildExecutiveReviewSystemPrompt();
  const userMessage = buildExecutiveReviewUserMessage(params.context, params.historicalMemories ?? []);

  const base = {
    provider: params.provider.name,
    model: params.model,
  };

  const raced = await raceWithTimeout(
    params.provider.complete({
      systemPrompt,
      userMessage,
      contextMessages: [],
      toolCatalogue: [],
    }),
    params.timeoutMs,
  );

  const latencyMs = Date.now() - started;

  if (raced.kind === 'timeout') {
    return {
      ...base,
      status: 'timeout',
      output: null,
      latencyMs,
      errorType: 'timeout',
      errorMessage: `Timeout após ${params.timeoutMs}ms.`,
    };
  }

  if (raced.kind === 'error') {
    if (raced.error instanceof ProviderHttpError) {
      return {
        ...base,
        status: 'provider_error',
        output: null,
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
      output: null,
      latencyMs,
      errorType: 'provider_error',
      errorMessage: sanitizeProviderMessage(message),
    };
  }

  const response = raced.value;

  const parsed = executiveReviewOutputSchema.safeParse(response.raw);

  if (!parsed.success) {
    return {
      ...base,
      status: 'invalid_output',
      output: null,
      latencyMs,
      usage: response.usage,
      errorType: response.rawParseFailed ? 'invalid_json' : 'schema_validation_error',
      errorMessage: sanitizeProviderMessage(
        parsed.error.issues[0]?.message ?? 'Saída do modelo não corresponde ao schema esperado de Executive Review.',
      ),
    };
  }

  return {
    ...base,
    status: 'ok',
    output: parsed.data,
    latencyMs,
    usage: response.usage,
  };
}
