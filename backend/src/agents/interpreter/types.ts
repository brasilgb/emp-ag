/**
 * Segundo nível de interpretação (seção 54), abaixo do AgentRouter: dado
 * que já sabemos o agente/departamento (seção 19 é domain-level apenas),
 * decide qual tool específica chamar e com quais parâmetros. `input` é
 * sempre validado de novo pelo Zod schema da tool antes de executar
 * (pipeline de execução, nunca confia neste resultado diretamente).
 */
export interface InterpretResult {
  toolHandler: string;
  input: Record<string, unknown>;
}

export interface AgentInterpreter {
  interpret(message: string, agentSlug: string): InterpretResult | null;
}
