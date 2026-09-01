import { z } from 'zod';

/**
 * Agentes v1.5 — Reasons fechados (correio.md seção 16). Único ponto de
 * verdade sobre os motivos de bloqueio do Autonomy Guard — usado tanto
 * para o valor gravado em agent_autonomy_blocks.reason quanto (via
 * `satisfies`, ver agents/errors.ts) para os novos membros de
 * AgentErrorCode. Nunca uma string arbitrária solta pelo código.
 *
 * `global_autonomy_disabled` não aparece aqui: esse bloqueio continua
 * ocorrendo antes do Autonomy Guard, no mesmo lugar/mensagem de hoje
 * (agents/jobs/global-switch.ts + o AgentErrorCode `job_autonomy_disabled`
 * já existente, comportamento v1.3/v1.4 intocado) — documentar isso é a
 * própria decisão da seção 10 ("a ordem definitiva deve ser documentada").
 */
export const AUTONOMY_BLOCK_REASONS = [
  'autonomy_job_disabled',
  'autonomy_depth_exceeded',
  'autonomous_cycle_detected',
  'autonomy_chain_budget_exceeded',
  'autonomous_rate_limit_exceeded',
  'autonomy_circuit_open',
] as const;

export const autonomyBlockReasonSchema = z.enum(AUTONOMY_BLOCK_REASONS);

export type AutonomyBlockReason = z.infer<typeof autonomyBlockReasonSchema>;
