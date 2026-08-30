import type { ZodType } from 'zod';

/**
 * Contrato comum de execução de tool (seção 50). Nenhuma tool recebe
 * estado global implícito — tudo que ela precisa chega via `context`
 * (seção 49).
 */
export interface ToolContext {
  userId: number;
  agentId: number;
  agentSlug: string;
  conversationId: number | null;
  executionId: number;
  permissions: Set<string>;
}

export interface ToolResult<TData = unknown> {
  success: boolean;
  summary: string;
  data: TData;
  metadata?: Record<string, unknown>;
}

export type ToolHandler<TInput = unknown, TData = unknown> = (
  input: TInput,
  context: ToolContext,
) => Promise<ToolResult<TData>>;

export type AutonomyLevel =
  | 'read'
  | 'prepare'
  | 'execute'
  | 'approval_required';

/**
 * Definição de uma tool em código. `handler` deve corresponder ao valor
 * salvo em `agent_tools.handler` no banco — o banco é o catálogo
 * (descrição, department, autonomy_level, is_sensitive); o código é a
 * única fonte de verdade para validação de input e para a permission de
 * usuário exigida (seção 29/51 — nunca confiar em payload/JSONB vindo do
 * banco ou de um futuro LLM).
 */
export interface ToolDefinition<TInput = any, TData = unknown> {
  handler: string;
  requiredPermission: string;
  inputSchema: ZodType<TInput>;
  run: ToolHandler<TInput, TData>;
}
