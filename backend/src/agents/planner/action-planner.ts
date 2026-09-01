import { buildToolCatalogueForLLM } from '../llm/catalogue.js';
import { ProviderHttpError, sanitizeProviderMessage } from '../llm/error-classification.js';
import type { InterpretationErrorType } from '../llm/error-classification.js';
import type { LLMProvider, LLMUsage } from '../llm/types.js';
import { buildPlannerSystemPrompt } from './prompt.js';
import { actionPlanSchema } from './schemas.js';
import type { ActionPlanPayload } from './schemas.js';

export type ActionPlannerStatus = 'ok' | 'empty' | 'timeout' | 'provider_error' | 'invalid_output';

export interface ActionPlannerResult {
  status: ActionPlannerStatus;
  plan: ActionPlanPayload | null;
  latencyMs: number;
  provider: string;
  model: string;
  usage?: LLMUsage;
  errorType?: InterpretationErrorType;
  errorMessage?: string;
  statusCode?: number;
}

type RaceResult<T> = { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

// Cópia local do mesmo racional de agents/llm/interpreter.ts:raceWithTimeout
// — nunca deixa uma rejeição do provider escapar como exceção não tratada.
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
 * Action Planner (correio.md seção 2): transforma um objetivo em texto
 * livre em um Action Plan estruturado. Só monta o prompt, chama o
 * provider e valida o SHAPE (Zod .strict()) — nunca decide se uma ação
 * pode executar (isso é o Action Policy Evaluator) nem verifica se
 * agent/tool realmente existem no registry/banco (isso é
 * planner/validator.ts, chamado depois por routes/agents/action-plans.ts).
 */
export async function planActions(params: {
  provider: LLMProvider;
  model: string;
  objective: string;
  timeoutMs: number;
}): Promise<ActionPlannerResult> {
  const started = Date.now();

  const toolCatalogue = await buildToolCatalogueForLLM();
  const systemPrompt = buildPlannerSystemPrompt(toolCatalogue);

  const base = {
    provider: params.provider.name,
    model: params.model,
  };

  const raced = await raceWithTimeout(
    params.provider.complete({
      systemPrompt,
      userMessage: params.objective,
      contextMessages: [],
      toolCatalogue,
    }),
    params.timeoutMs,
  );

  const latencyMs = Date.now() - started;

  if (raced.kind === 'timeout') {
    return {
      ...base,
      status: 'timeout',
      plan: null,
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
        plan: null,
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
      plan: null,
      latencyMs,
      errorType: 'provider_error',
      errorMessage: sanitizeProviderMessage(message),
    };
  }

  const response = raced.value;

  const parsed = actionPlanSchema.safeParse(response.raw);

  if (!parsed.success) {
    return {
      ...base,
      status: 'invalid_output',
      plan: null,
      latencyMs,
      usage: response.usage,
      errorType: response.rawParseFailed ? 'invalid_json' : 'schema_validation_error',
      errorMessage: sanitizeProviderMessage(
        parsed.error.issues[0]?.message ?? 'Saída do modelo não corresponde ao schema esperado de Action Plan.',
      ),
    };
  }

  if (parsed.data.actions.length === 0) {
    return {
      ...base,
      status: 'empty',
      plan: parsed.data,
      latencyMs,
      usage: response.usage,
    };
  }

  return {
    ...base,
    status: 'ok',
    plan: parsed.data,
    latencyMs,
    usage: response.usage,
  };
}
