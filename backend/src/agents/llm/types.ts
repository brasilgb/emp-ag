/**
 * Catálogo de tool exposto ao modelo (seção 8): só o que é seguro/público.
 * Nunca inclui SQL, credenciais, connection strings ou detalhes do
 * tool-registry em código (a função TS real, o Zod completo, a
 * requiredPermission) — só o suficiente para o modelo escolher e montar
 * argumentos.
 */
export interface LLMToolCatalogueEntry {
  agent: string;
  tool: string;
  description: string;
  department: string;
  // Schema simplificado: nome do campo → tipo primitivo + obrigatório,
  // nunca o objeto Zod real.
  inputSchema: Record<string, { type: string; required: boolean }>;
}

export interface LLMContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  contextMessages: LLMContextMessage[];
  toolCatalogue: LLMToolCatalogueEntry[];
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Resposta crua do provider, já parseada como JSON mas AINDA NÃO validada
 * contra o schema estrutural (isso é responsabilidade de
 * llm/interpreter.ts, nunca do provider). `raw` existe só para
 * diagnóstico de erro (ex.: "JSON inválido") — nunca é persistido como
 * raciocínio do modelo (seção 11/18 da v1).
 */
export interface LLMResponse {
  raw: unknown;
  usage?: LLMUsage;
  // true só quando o provider recebeu texto que NÃO é JSON válido (raw
  // vira o texto cru nesse caso) — permite ao interpreter.ts distinguir
  // invalid_json de schema_validation_error sem adivinhar a partir do
  // tipo de `raw` (um `raw` string também é o resultado legítimo de um
  // JSON.parse bem-sucedido de um literal de string).
  rawParseFailed?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}
