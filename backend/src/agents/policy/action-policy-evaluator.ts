import { env } from '../../config/env.js';
import type { AutonomyLevel } from '../types.js';

export type ActionDecision =
  | { decision: 'execute' }
  | { decision: 'approval_required'; reason: string }
  | { decision: 'blocked'; reason: string }
  | { decision: 'shadow'; reason: string };

export interface ActionPolicyToolInfo {
  requiredPermission: string;
  autonomyLevel: AutonomyLevel;
  isSensitive: boolean;
  risk: 'read' | 'low' | 'medium' | 'high';
  mutatesData: boolean;
  requiresApproval: boolean;
}

export interface ActionPolicyInput {
  tool: ActionPolicyToolInfo;
  userPermissions: Set<string>;
  // Override do par agente↔tool, mesmo campo já usado em
  // agent_tool_permissions pelo pipeline v1.1 (execution/pipeline.ts) —
  // reaproveitado aqui para não duplicar a fonte de verdade de "esse
  // agente específico precisa de aprovação mesmo numa tool que
  // normalmente não exigiria".
  requiresApprovalOverride: boolean;
  shadowModeActive: boolean;
  confidence: number;
}

/**
 * Action Policy Evaluator (correio.md seção 3): decide, por ação de um
 * Action Plan, se ela pode executar automaticamente, precisa de aprovação
 * humana, deve ser bloqueada, ou deve permanecer só como sugestão (shadow).
 * Função pura e determinística — o LLM nunca participa desta decisão
 * (mesmo princípio de execution/pipeline.ts para a execução única da
 * v1.1); a única entrada vinda do LLM é `confidence`, e só para decidir se
 * a ação é confiável o bastante para sequer ser considerada — nunca para
 * decidir a permissão em si.
 */
export function evaluateAction(input: ActionPolicyInput): ActionDecision {
  const { tool } = input;

  // 1. Permissão do usuário é sempre a primeira barreira — sem ela, nem
  // shadow mode nem baixo risco liberam a ação.
  if (!input.userPermissions.has(tool.requiredPermission)) {
    return {
      decision: 'blocked',
      reason: 'Usuário não possui a permissão necessária para esta ferramenta.',
    };
  }

  // 2. Risco alto, exigência explícita da tool, ou override de
  // agente↔tool: aprovação humana sempre, sem exceção nesta versão
  // (correio.md seção 4 — "Sempre exigir aprovação explícita").
  if (tool.risk === 'high') {
    return {
      decision: 'approval_required',
      reason: 'Ferramenta classificada como risco alto — aprovação obrigatória.',
    };
  }

  if (tool.requiresApproval || tool.isSensitive || input.requiresApprovalOverride) {
    return {
      decision: 'approval_required',
      reason: 'Ferramenta ou par agente/ferramenta exige aprovação explícita.',
    };
  }

  // 3. Confiança insuficiente do LLM: a ação não é descartada, mas também
  // não é confiável o bastante para autoexecutar nem para incomodar um
  // aprovador humano às cegas — fica só como sugestão (shadow).
  if (input.confidence < env.AGENT_LLM_MIN_CONFIDENCE) {
    return {
      decision: 'shadow',
      reason: `Confiança (${input.confidence}) abaixo do mínimo configurado (${env.AGENT_LLM_MIN_CONFIDENCE}).`,
    };
  }

  // 4. Shadow Mode global (correio.md seção 11): nenhuma ação que altera
  // dados executa de fato enquanto o modo estiver ativo — só read-only
  // segue adiante.
  if (input.shadowModeActive && tool.mutatesData) {
    return {
      decision: 'shadow',
      reason: 'Shadow Mode ativo — ações que alteram dados não são executadas.',
    };
  }

  // 5. Read-only com permissão: sempre pode executar automaticamente.
  if (tool.risk === 'read') {
    return { decision: 'execute' };
  }

  // 6. Fallback: mesmo cálculo de autonomia efetiva do pipeline v1.1
  // (execution/pipeline.ts) — só autonomy_level='approval_required'
  // força aprovação; 'read'/'prepare'/'execute' executam diretamente
  // dada a permissão.
  if (tool.autonomyLevel === 'approval_required') {
    return {
      decision: 'approval_required',
      reason: 'Nível de autonomia da ferramenta exige aprovação.',
    };
  }

  return { decision: 'execute' };
}
