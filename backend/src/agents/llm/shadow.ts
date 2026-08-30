import { db } from '../../db/index.js';
import { agentInterpretations } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { executeTool } from '../execution/pipeline.js';
import type { ExecuteToolOutcome } from '../execution/pipeline.js';
import { sanitizeProviderMessage } from './error-classification.js';
import { getLLMProvider } from './factory.js';
import { interpretWithLLM } from './interpreter.js';
import type { LLMInterpretationResult, LLMInterpretationStatus } from './interpreter.js';

export interface ShadowOrFallbackParams {
  conversationId: number;
  messageId: number | null;
  userMessage: string;
  userId: number;
  deterministicAgent: string | null;
  deterministicTool: string | null;
}

export interface ShadowOrFallbackOutcome {
  ran: boolean;
  mode: 'shadow' | 'fallback' | null;
  llm: LLMInterpretationResult | null;
  // Só preenchido em modo fallback quando uma tool chegou a ser
  // executada pelo pipeline reusado da v1 (seção 16 — autonomia/aprovação
  // continuam valendo integralmente).
  fallbackExecution: ExecuteToolOutcome | null;
  // Só preenchido em modo fallback quando a confiança ficou abaixo do
  // limiar ou o modelo pediu esclarecimento (seção 17 — nenhuma tool
  // executada).
  fallbackClarification: string | null;
}

// Status em que o modelo efetivamente respondeu algo comparável (mesmo
// que inválido) — usados para calcular `matched`. Estados de
// infraestrutura (timeout/provider_error/invalid_output) não têm um lado
// "LLM" comparável, então `matched` fica null nesses casos.
const COMPARABLE_STATUSES: LLMInterpretationStatus[] = [
  'ok',
  'unknown',
  'invalid_tool',
  'invalid_agent',
  'invalid_arguments',
  'clarification',
];

function computeMatched(deterministicTool: string | null, llm: LLMInterpretationResult): boolean | null {
  if (!COMPARABLE_STATUSES.includes(llm.status)) {
    return null;
  }

  // "Nenhum dos dois reconheceu nada" (both_unknown) não é um match real
  // — sem este caso especial, `null === null` cairia no `true` abaixo,
  // inflando artificialmente matches/match rate (corrigido: both_unknown
  // nunca conta como match, GET /agents/interpreter/stats também exclui
  // esse caso do denominador do match rate).
  if (deterministicTool === null && llm.tool === null) {
    return false;
  }

  return deterministicTool === llm.tool;
}

async function logInterpretation(params: {
  conversationId: number;
  messageId: number | null;
  deterministicAgent: string | null;
  deterministicTool: string | null;
  llm: LLMInterpretationResult;
  mode: 'shadow' | 'fallback';
}) {
  const matched = computeMatched(params.deterministicTool, params.llm);

  // Classificação curta (seção 30-bis) — `type` vem da taxonomia fixa de
  // error-classification.ts, calculada por interpreter.ts. `message`
  // passa de novo por sanitizeProviderMessage() aqui como segunda camada
  // de defesa (nunca API key/headers/credenciais), independente de já
  // estar sanitizada na origem. `statusCode` só existe para
  // provider_http_error.
  const error = params.llm.errorType
    ? {
        type: params.llm.errorType,
        message: params.llm.errorMessage
          ? sanitizeProviderMessage(params.llm.errorMessage, env.AGENT_LLM_API_KEY)
          : null,
        ...(params.llm.statusCode !== undefined ? { statusCode: params.llm.statusCode } : {}),
      }
    : null;

  await db.insert(agentInterpretations).values({
    conversationId: params.conversationId,
    messageId: params.messageId,
    deterministicAgent: params.deterministicAgent,
    deterministicTool: params.deterministicTool,
    llmAgent: params.llm.agent,
    llmTool: params.llm.tool,
    llmArguments: params.llm.arguments,
    llmConfidence: params.llm.confidence !== null ? params.llm.confidence.toFixed(3) : null,
    matched,
    mode: params.mode,
    latencyMs: params.llm.latencyMs,
    provider: params.llm.provider,
    model: params.llm.model,
    error,
  });
}

/**
 * Seção 10 (shadow) / 14 (fallback). Nunca lança — falha do LLM (timeout,
 * erro de provider, saída inválida) é sempre registrada e absorvida, o
 * chat sempre segue com o resultado determinístico já calculado por
 * chat.ts antes desta chamada.
 */
export async function runShadowOrFallback(params: ShadowOrFallbackParams): Promise<ShadowOrFallbackOutcome> {
  if (!env.AGENT_LLM_ENABLED) {
    return { ran: false, mode: null, llm: null, fallbackExecution: null, fallbackClarification: null };
  }

  const mode: 'shadow' | 'fallback' = env.AGENT_LLM_SHADOW_MODE ? 'shadow' : 'fallback';

  // Seção 15: em fallback, perguntas já reconhecidas pelo determinístico
  // não passam pelo LLM — só entra quando a intenção é desconhecida. Em
  // shadow, sempre roda (seção 10), para medir mesmo os casos já
  // reconhecidos.
  if (mode === 'fallback' && params.deterministicTool !== null) {
    return { ran: false, mode, llm: null, fallbackExecution: null, fallbackClarification: null };
  }

  let llm: LLMInterpretationResult;

  try {
    llm = await interpretWithLLM({
      provider: getLLMProvider(),
      model: env.AGENT_LLM_MODEL,
      userMessage: params.userMessage,
      conversationId: params.conversationId,
      timeoutMs: env.AGENT_LLM_TIMEOUT_MS,
      minConfidence: env.AGENT_LLM_MIN_CONFIDENCE,
    });
  } catch (error) {
    // Defesa extra: interpretWithLLM já não deveria lançar (erros viram
    // status='provider_error'), mas nunca deixamos uma falha aqui
    // comprometer o chat (seção 13).
    llm = {
      status: 'provider_error',
      agent: null,
      tool: null,
      arguments: {},
      confidence: null,
      latencyMs: 0,
      provider: env.AGENT_LLM_PROVIDER,
      model: env.AGENT_LLM_MODEL,
      errorType: 'provider_error',
      errorMessage: error instanceof Error ? error.message : 'Falha inesperada no LLM interpreter.',
    };
  }

  await logInterpretation({
    conversationId: params.conversationId,
    messageId: params.messageId,
    deterministicAgent: params.deterministicAgent,
    deterministicTool: params.deterministicTool,
    llm,
    mode,
  });

  if (mode === 'shadow') {
    // Seção 12: shadow NUNCA afeta a resposta.
    return { ran: true, mode, llm, fallbackExecution: null, fallbackClarification: null };
  }

  // Fallback mode a partir daqui.
  if (llm.status === 'clarification') {
    return {
      ran: true,
      mode,
      llm,
      fallbackExecution: null,
      fallbackClarification: llm.clarificationQuestion ?? 'Pode detalhar melhor o que você precisa?',
    };
  }

  if (llm.status !== 'ok' || llm.confidence === null || llm.confidence < env.AGENT_LLM_MIN_CONFIDENCE) {
    // Confiança baixa (seção 8/17) ou interpretação inválida — nenhuma
    // tool executada, sem pedir esclarecimento específico (o modelo não
    // pediu). chat.ts cai no fluxo padrão de intenção desconhecida.
    return { ran: true, mode, llm, fallbackExecution: null, fallbackClarification: null };
  }

  // confidence >= threshold e interpretação estruturalmente válida:
  // executa pelo MESMO pipeline da v1 (agente/tool/permissão/autonomia/
  // aprovação — seção 16, nada disso é pulado).
  const execution = await executeTool({
    userId: params.userId,
    agentSlug: llm.agent!,
    toolHandler: llm.tool!,
    input: llm.arguments,
    conversationId: params.conversationId,
  });

  return { ran: true, mode, llm, fallbackExecution: execution, fallbackClarification: null };
}
