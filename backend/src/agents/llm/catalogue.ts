import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentTools } from '../../db/schema/index.js';
import { getTool } from '../tool-registry.js';
import type { LLMToolCatalogueEntry } from './types.js';

// Deriva {campo: {type, required}} a partir do schema Zod real da tool
// (zod v4 tem z.toJSONSchema nativo) — nunca envia o objeto Zod completo
// ao modelo, só um resumo estrutural (seção 8: "input schema
// simplificado").
function simplifyInputSchema(schema: z.ZodType): LLMToolCatalogueEntry['inputSchema'] {
  try {
    const jsonSchema = z.toJSONSchema(schema, { unrepresentable: 'any' }) as {
      properties?: Record<string, { type?: string | string[] }>;
      required?: string[];
    };

    const properties = jsonSchema.properties ?? {};
    const required = new Set(jsonSchema.required ?? []);

    const result: LLMToolCatalogueEntry['inputSchema'] = {};

    for (const [field, prop] of Object.entries(properties)) {
      const type = Array.isArray(prop.type) ? prop.type[0] : (prop.type ?? 'string');
      result[field] = { type: type ?? 'string', required: required.has(field) };
    }

    return result;
  } catch {
    // Schema não representável em JSON Schema (raro) — melhor um catálogo
    // vazio para essa tool do que quebrar a montagem de todo o catálogo.
    return {};
  }
}

/**
 * Catálogo entregue ao LLM (seção 8): só tools ativas no banco E
 * registradas em código, com slug/descrição/department/schema
 * simplificado. Nunca inclui handler interno de implementação, SQL,
 * credenciais ou connection strings — o "tool" aqui é o mesmo
 * `agent_tools.handler` (ex.: "finance.get_summary") já público desde a
 * v1 (aparece em `tool:` na resposta do chat).
 */
export async function buildToolCatalogueForLLM(): Promise<LLMToolCatalogueEntry[]> {
  const rows = await db
    .select()
    .from(agentTools)
    .where(eq(agentTools.isActive, true))
    .orderBy(asc(agentTools.department), asc(agentTools.name));

  const catalogue: LLMToolCatalogueEntry[] = [];

  for (const row of rows) {
    const registryEntry = getTool(row.handler);

    if (!registryEntry) {
      continue;
    }

    catalogue.push({
      agent: row.department,
      tool: row.handler,
      description: row.description ?? row.name,
      department: row.department,
      inputSchema: simplifyInputSchema(registryEntry.inputSchema),
    });
  }

  return catalogue;
}
