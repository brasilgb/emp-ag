/**
 * Taxonomia curta para classificar o resultado de uma interpretação do
 * LLM Interpreter sempre que ela NÃO vira uma tool call limpa e confiante
 * — usada tanto para persistir agent_interpretations.error quanto para
 * agrupar em GET /agents/interpreter/stats (errorsByType). `provider_error`
 * é uma extensão nossa (falha de invocação sem HTTP status — rede, API
 * key ausente etc.) além da lista original, mantida separada de
 * provider_http_error (que sempre tem um statusCode real do provider).
 */
export const INTERPRETATION_ERROR_TYPES = [
  'timeout',
  'provider_http_error',
  'provider_error',
  'invalid_json',
  'schema_validation_error',
  'invalid_agent',
  'invalid_tool',
  'invalid_arguments',
  'low_confidence',
  'clarification',
] as const;

export type InterpretationErrorType = (typeof INTERPRETATION_ERROR_TYPES)[number];

const MAX_MESSAGE_LENGTH = 300;

// Defesa em profundidade: nenhuma dessas fontes deveria conter a API key
// ou headers de autenticação para começo de conversa (a key só é enviada
// no header da requisição ao Gemini, nunca ecoada em corpo/mensagem de
// erro) — mas sanitiza mesmo assim antes de persistir/exibir, tanto o
// valor exato da key configurada quanto qualquer coisa no formato de
// header de autenticação.
const AUTH_HEADER_PATTERN = /(authorization|x-goog-api-key|api[-_]?key)\s*[:=]\s*\S+/gi;

export function sanitizeProviderMessage(message: string, apiKey?: string): string {
  let sanitized = message;

  if (apiKey) {
    sanitized = sanitized.split(apiKey).join('[REDACTED]');
  }

  sanitized = sanitized.replace(AUTH_HEADER_PATTERN, '[REDACTED]');

  return sanitized.slice(0, MAX_MESSAGE_LENGTH);
}

// Erro de HTTP do provider (ex.: Gemini respondendo 4xx/5xx) — carrega o
// statusCode separado da mensagem para quem consome (interpreter.ts/
// shadow.ts) nunca precisar fazer parsing de string.
export class ProviderHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.statusCode = statusCode;
  }
}
