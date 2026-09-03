import { ProviderHttpError, sanitizeProviderMessage } from '../../llm/error-classification.js';
import type { InterpretationErrorType } from '../../llm/error-classification.js';
import type { LLMProvider, LLMUsage } from '../../llm/types.js';

import type { StrategicMemoryEvidence } from './context.js';
import { buildStrategicMemorySystemPrompt, buildStrategicMemoryUserMessage } from './prompt.js';
import { strategicMemoryOutputSchema } from './schemas.js';
import type { StrategicMemoryOutput } from './schemas.js';

export type MemoryExtractorStatus = 'ok' | 'timeout' | 'provider_error' | 'invalid_output';

export interface MemoryExtractorResult {
  status: MemoryExtractorStatus;
  output: StrategicMemoryOutput | null;
  latencyMs: number;
  provider: string;
  model: string;
  usage?: LLMUsage;
  errorType?: InterpretationErrorType;
  errorMessage?: string;
  statusCode?: number;
}

type RaceResult<T> = { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

// Cópia local do mesmo racional de reviews/executive-reviewer.ts:raceWithTimeout
// — nunca deixa uma rejeição do provider escapar como exceção não
// tratada, e nunca segura recurso nenhum (este módulo não importa `db`,
// `executor` nem `policy` — seção 6: "não escreve diretamente no banco,
// recebe DTO preparado, retorna apenas saída Zod validada").
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
 * Memory Extractor (correio.md seção 6/7) — recebe a evidência já
 * normalizada (`buildStrategicMemoryEvidence`), chama o provider LLM
 * oficial, valida a saída com Zod, devolve SOMENTE title/summary/lesson/
 * confidence/importance/tags. Nunca importa `executor`/`policy`/
 * permission, nunca toca o banco (persistência é responsabilidade
 * exclusiva de `memory-service.ts`).
 */
export async function extractStrategicMemory(params: {
  provider: LLMProvider;
  model: string;
  evidence: StrategicMemoryEvidence;
  timeoutMs: number;
}): Promise<MemoryExtractorResult> {
  const started = Date.now();

  const systemPrompt = buildStrategicMemorySystemPrompt();
  const userMessage = buildStrategicMemoryUserMessage(params.evidence);

  const base = { provider: params.provider.name, model: params.model };

  const raced = await raceWithTimeout(
    params.provider.complete({ systemPrompt, userMessage, contextMessages: [], toolCatalogue: [] }),
    params.timeoutMs,
  );

  const latencyMs = Date.now() - started;

  if (raced.kind === 'timeout') {
    return { ...base, status: 'timeout', output: null, latencyMs, errorType: 'timeout', errorMessage: `Timeout após ${params.timeoutMs}ms.` };
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
    return { ...base, status: 'provider_error', output: null, latencyMs, errorType: 'provider_error', errorMessage: sanitizeProviderMessage(message) };
  }

  const response = raced.value;
  const parsed = strategicMemoryOutputSchema.safeParse(response.raw);

  if (!parsed.success) {
    return {
      ...base,
      status: 'invalid_output',
      output: null,
      latencyMs,
      usage: response.usage,
      errorType: response.rawParseFailed ? 'invalid_json' : 'schema_validation_error',
      errorMessage: sanitizeProviderMessage(
        parsed.error.issues[0]?.message ?? 'Saída do modelo não corresponde ao schema esperado de Strategic Memory.',
      ),
    };
  }

  return { ...base, status: 'ok', output: parsed.data, latencyMs, usage: response.usage };
}
