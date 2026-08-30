import type { ToolResult } from '../types.js';

export interface ComposeInput {
  agentName: string;
  toolHandler: string;
  result: ToolResult;
}

/**
 * ToolResult → texto de resposta do chat (seção 33/42). Cada handler já
 * retorna seu próprio `summary` pronto — o composer só adiciona o prefixo
 * de transparência de tool consultada, nunca reformula/recalcula dados.
 */
export interface ResponseComposer {
  compose(input: ComposeInput): string;
}
