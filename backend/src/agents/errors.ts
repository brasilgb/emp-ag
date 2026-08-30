// Códigos de erro controlados do módulo de agentes (seção 53). Nunca
// devolver stack trace ao frontend — sempre um AgentError com código e
// mensagem amigável.
export type AgentErrorCode =
  | 'validation_error'
  | 'permission_denied'
  | 'approval_required'
  | 'tool_not_found'
  | 'agent_not_found'
  | 'execution_failed'
  | 'router_unknown'
  | 'rate_limited'
  | 'conflict';

const STATUS_BY_CODE: Record<AgentErrorCode, number> = {
  validation_error: 400,
  permission_denied: 403,
  approval_required: 202,
  tool_not_found: 404,
  agent_not_found: 404,
  execution_failed: 422,
  router_unknown: 200,
  rate_limited: 429,
  conflict: 409,
};

export class AgentError extends Error {
  code: AgentErrorCode;
  status: number;
  details?: unknown;

  constructor(code: AgentErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
