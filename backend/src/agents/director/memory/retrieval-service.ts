import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentStrategicMemories } from '../../../db/schema/index.js';

import type { RelevantMemorySummary } from './context.js';
import { CONTEXTUAL_MEMORY_STATUSES, DEFAULT_RELEVANT_MEMORIES_LIMIT, MAX_RELEVANT_MEMORIES_LIMIT } from './types.js';
import type { MemoryType } from './types.js';

const IMPORTANCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Agentes v2.3 (correio.md seção 9/10) — recuperação SIMPLES e
 * determinística (nunca vector database/embeddings nesta versão, seção
 * 10). Critérios explícitos: `domain` (obrigatório), `memory_type`
 * (opcional), `importance`, `confidence`, `recency` — ordenados nessa
 * prioridade (importância > confiança > mais recente primeiro). Só
 * memórias `status='active'` entram (seção 28 item 10: "memórias
 * arquivadas não contaminarem contexto" — `draft`/`superseded` também
 * ficam de fora pelo mesmo racional). Limite explícito, nunca histórico
 * ilimitado (seção 9): `limit` é capado em
 * `MAX_RELEVANT_MEMORIES_LIMIT` mesmo que o caller peça mais.
 *
 * A ordenação por importância/confiança é feita em memória (JS), não em
 * SQL — o volume esperado de memórias `active` por domínio é pequeno o
 * bastante (uma por Executive Review) para não justificar um `ORDER BY`
 * com `CASE` só para mapear enum→rank; mantém a query simples e a lógica
 * de rank em um único lugar testável.
 */
export async function getRelevantStrategicMemories(params: {
  domain: string;
  memoryType?: MemoryType;
  limit?: number;
}): Promise<RelevantMemorySummary[]> {
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_RELEVANT_MEMORIES_LIMIT, 1), MAX_RELEVANT_MEMORIES_LIMIT);

  const conditions = [eq(agentStrategicMemories.domain, params.domain), eq(agentStrategicMemories.status, CONTEXTUAL_MEMORY_STATUSES[0])];
  if (params.memoryType) conditions.push(eq(agentStrategicMemories.memoryType, params.memoryType));

  // Busca uma janela maior que `limit` (capada) para poder reordenar por
  // importância/confiança em memória sem paginar demais — `recency` já
  // vem do próprio ORDER BY do SQL como critério de desempate/pré-filtro.
  const candidates = await db
    .select()
    .from(agentStrategicMemories)
    .where(and(...conditions))
    .orderBy(desc(agentStrategicMemories.createdAt))
    .limit(Math.max(limit * 4, 20));

  const ranked = candidates
    .slice()
    .sort((a, b) => {
      const importanceDelta = (IMPORTANCE_RANK[b.importance ?? ''] ?? 0) - (IMPORTANCE_RANK[a.importance ?? ''] ?? 0);
      if (importanceDelta !== 0) return importanceDelta;

      const confidenceDelta = Number(b.confidence ?? 0) - Number(a.confidence ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;

      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit);

  return ranked.map((memory) => ({
    id: memory.id,
    memoryType: memory.memoryType,
    domain: memory.domain,
    title: memory.title ?? '',
    lesson: memory.lesson ?? '',
    confidence: memory.confidence === null ? null : Number(memory.confidence),
    importance: memory.importance,
    createdAt: memory.createdAt.toISOString(),
  }));
}
