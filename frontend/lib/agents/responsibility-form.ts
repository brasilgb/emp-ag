import type { EscalationPolicy } from "@/types/agents";

/**
 * Agentes v2.6 ("Fechamento antes do commit", itens 2/4) — lógica pura
 * extraída de `EditResponsibilityDialog` para ser coberta por teste real
 * (o projeto não tem infraestrutura de teste de renderização de
 * componentes — nenhuma dependência de testing-library/jsdom existe;
 * adicionar uma agora seria um mecanismo novo fora do escopo "estritamente
 * aditivo e limitado" pedido). Estas duas funções concentram toda a
 * lógica de validação/derivação do formulário que TEM cobertura real
 * possível sem renderizar nada.
 */

/**
 * Valida e converte o texto do campo `conditions` (JSON livre, nunca
 * interpretado como código/DSL — só persistido como está). Lança um
 * `Error` com mensagem amigável quando o texto não é um objeto JSON
 * válido, para o chamador decidir como apresentar o erro (toast).
 */
export function parseConditionsInput(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Conditions precisa ser um JSON válido (um objeto).");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Conditions precisa ser um JSON válido (um objeto).");
  }

  return parsed as Record<string, unknown>;
}

/**
 * Ao trocar a `escalationPolicy`, devolve os valores de
 * agentId/userId de alvo que devem sobreviver à troca — esvazia (por UX)
 * o campo que deixou de ser exigido pela nova política. O backend
 * continua validando a combinação de qualquer forma (autoridade
 * definitiva) — isto é só uma conveniência de UX, nunca uma regra de
 * negócio nova.
 */
export function escalationTargetsForPolicyChange(
  policy: EscalationPolicy,
  current: { agentId: string; userId: string },
): { agentId: string; userId: string } {
  const stillNeedsAgent = policy === "agent" || policy === "agent_then_human";
  const stillNeedsUser = policy === "human" || policy === "agent_then_human";

  return {
    agentId: stillNeedsAgent ? current.agentId : "",
    userId: stillNeedsUser ? current.userId : "",
  };
}
