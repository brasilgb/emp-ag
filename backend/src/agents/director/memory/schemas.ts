import { z } from 'zod';

import { MEMORY_IMPORTANCE_LEVELS } from './types.js';

/**
 * Agentes v2.3 (correio.md seção 7) — contrato estrutural da saída do
 * memory extractor (LLM). `.strict()`: qualquer campo fora desta lista
 * (tool, action, execute, permission, approval, autonomy, sql, command
 * — a lista explícita de proibidos da seção 7) é rejeitado pelo Zod
 * antes de qualquer outra validação. A própria estrutura NÃO oferece
 * nenhum campo capaz de disparar execução — garantia estrutural, não uma
 * checagem de blocklist à parte (mesmo princípio de
 * `reviews/schemas.ts`).
 */
export const strategicMemoryOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    summary: z.string().trim().min(1).max(1000),
    lesson: z.string().trim().min(1).max(2000),
    confidence: z.number().min(0).max(1),
    importance: z.enum(MEMORY_IMPORTANCE_LEVELS),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
  })
  .strict();

export type StrategicMemoryOutput = z.infer<typeof strategicMemoryOutputSchema>;
