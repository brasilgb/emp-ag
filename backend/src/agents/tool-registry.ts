import type { ToolDefinition } from './types.js';

/**
 * Registry de tools em código: slug (agent_tools.handler) → definição real
 * (schema Zod + permission exigida + função). O campo `handler` no banco é
 * só o link para cá — nunca há execução de código arbitrário vindo do
 * banco (seção 9).
 */
const registry = new Map<string, ToolDefinition>();

export function registerTool(definition: ToolDefinition): void {
  if (registry.has(definition.handler)) {
    throw new Error(
      `Tool handler duplicado no registry: ${definition.handler}`,
    );
  }

  registry.set(definition.handler, definition);
}

export function getTool(handler: string): ToolDefinition | undefined {
  return registry.get(handler);
}

export function listRegisteredHandlers(): string[] {
  return [...registry.keys()];
}

// Uso exclusivo de testes: permite limpar o registry entre suítes que
// registram tools de teste isoladas (agents/tools/__test-support__.ts).
export function clearRegistryForTests(): void {
  registry.clear();
}
