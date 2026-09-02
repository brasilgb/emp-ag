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
  | 'conflict'
  // Agentes v1.2 — Action Planning (correio.md seção 8): LLM desligado
  // (AGENT_LLM_ENABLED=false) ou planner incapaz de produzir um Action
  // Plan estruturalmente válido (timeout, erro de provider, saída
  // inválida do modelo).
  | 'llm_unavailable'
  | 'planning_failed'
  // Agentes v1.3 — Jobs/Runs (correio.md seções 8/9/14): teto de ações do
  // Job Run estourado antes de qualquer persistência, e a família de erros
  // de Job/Run (agents/jobs/*).
  | 'plan_too_large'
  | 'job_not_found'
  | 'job_run_not_found'
  | 'job_not_runnable'
  | 'job_agent_disabled'
  | 'job_autonomy_disabled'
  | 'job_run_already_active'
  | 'job_run_limit_exceeded'
  | 'job_action_limit_exceeded'
  | 'job_open_approval_limit_exceeded'
  | 'job_timeout'
  | 'invalid_trigger_config'
  // Agentes v1.5 — Autonomous Safety & Governance (correio.md seção 16):
  // reasons fechados do Autonomy Guard. `job_autonomy_disabled` (acima)
  // continua exclusivo do kill switch GLOBAL — este é o switch por Job.
  | 'autonomy_job_disabled'
  | 'autonomy_depth_exceeded'
  | 'autonomous_cycle_detected'
  | 'autonomy_chain_budget_exceeded'
  | 'autonomous_rate_limit_exceeded'
  | 'autonomy_circuit_open'
  // Agentes v2.2 — Executive Review (correio.md seção 24 "Falha do
  // provider"): o Executive Reviewer (LLM) não produziu uma avaliação
  // estruturalmente válida (timeout, erro de provider, saída inválida) —
  // mesmo racional de 'planning_failed', para o domínio de review em vez
  // de planejamento.
  | 'review_failed';

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
  llm_unavailable: 503,
  planning_failed: 422,
  plan_too_large: 422,
  job_not_found: 404,
  job_run_not_found: 404,
  job_not_runnable: 409,
  job_agent_disabled: 409,
  job_autonomy_disabled: 503,
  job_run_already_active: 409,
  job_run_limit_exceeded: 429,
  job_action_limit_exceeded: 422,
  job_open_approval_limit_exceeded: 429,
  job_timeout: 408,
  invalid_trigger_config: 400,
  autonomy_job_disabled: 503,
  autonomy_depth_exceeded: 409,
  autonomous_cycle_detected: 409,
  autonomy_chain_budget_exceeded: 429,
  autonomous_rate_limit_exceeded: 429,
  autonomy_circuit_open: 503,
  review_failed: 422,
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
