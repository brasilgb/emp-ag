// Departamentos v1 (seção 4). Preparado para futuramente aceitar
// marketing, development, qa, devops, legal, bi — sem implementá-los
// ainda.
export type Department = 'sales' | 'projects' | 'finance' | 'support' | 'customer_success';

export interface RouteResult {
  department: Department;
  agentSlug: string;
}

/**
 * Interface genérica de roteamento (seção 20): mensagem → departamento +
 * agente, ou null se a intenção não pôde ser identificada com segurança
 * (seção 35 — nunca inventar resposta). `DeterministicRouter` é a única
 * implementação nesta v1; um futuro `LLMRouter` implementaria a mesma
 * interface.
 */
export interface AgentRouter {
  route(message: string): RouteResult | null;
}
