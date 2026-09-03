import { and, count, desc, eq, isNotNull, ne, SQL } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoals, agentDirectorInitiatives, agentExecutiveReviews, agentStrategicMemories } from '../../../db/schema/index.js';
import { env } from '../../../config/env.js';
import { audit } from '../../../services/audit.js';
import { AgentError } from '../../errors.js';
import { getLLMProvider } from '../../llm/factory.js';

import { buildStrategicMemoryEvidence } from './context.js';
import { extractStrategicMemory } from './memory-extractor.js';
import type { MemoryStatus, MemoryType } from './types.js';

export type StrategicMemoryRow = typeof agentStrategicMemories.$inferSelect;
export type ExecutiveReviewRow = typeof agentExecutiveReviews.$inferSelect;

const POLL_INTERVAL_MS = 100;
// Mesmo racional de POLL_MAX_WAIT_MS em reviews/review-service.ts —
// generoso o bastante para cobrir env.AGENT_LLM_TIMEOUT_MS + margem.
const POLL_MAX_WAIT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMemoryCompletion(reviewId: number): Promise<StrategicMemoryRow> {
  const deadline = Date.now() + POLL_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const [row] = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, reviewId)).limit(1);

    if (!row) {
      throw new AgentError('conflict', 'A tentativa concorrente de gerar esta memória estratégica falhou — tente novamente.');
    }

    if (row.status !== 'draft') return row;

    await sleep(POLL_INTERVAL_MS);
  }

  throw new AgentError('conflict', 'Tempo esgotado aguardando a geração concorrente desta memória estratégica — tente novamente.');
}

export interface CreateStrategicMemoryResult {
  memory: StrategicMemoryRow;
  created: boolean;
}

/**
 * Agentes v2.3 (correio.md seções 4/13/14/15) — único ponto de entrada
 * para gerar a memória estratégica canônica de uma Executive Review
 * `completed`. Mesmo padrão de claim/concorrência já provado em
 * `reviews/review-service.ts:generateExecutiveReview` (v2.2):
 *
 * - A UNICIDADE de `source_review_id` na própria tabela É o claim
 *   (`INSERT ... ON CONFLICT DO NOTHING`, atômico, sem transação).
 * - Fora de qualquer transação: monta evidência (determinística, rápida)
 *   + chama o LLM extractor.
 * - Falha do provider → `catch` DELETA a linha `draft` (nunca presa —
 *   seção 15, "permitir retry seguro").
 * - Quem perde a corrida: se já `active`, devolve direto (idempotente,
 *   SEM chamar o LLM de novo); se ainda `draft`, aguarda via polling
 *   curto (sem lock).
 */
export async function createStrategicMemoryFromReview(review: ExecutiveReviewRow, actorUserId: number | null): Promise<CreateStrategicMemoryResult> {
  if (review.status !== 'completed') {
    throw new AgentError('conflict', `Executive Review está "${review.status}" — só é possível gerar memória a partir de uma review "completed".`);
  }

  const now = new Date();

  // Leitura rápida e determinística (não é o LLM, não segura nada) só
  // para preencher `domain` (NOT NULL) já no claim inicial — mantém o
  // claim o mais barato possível, sem esperar pelo restante do contexto.
  const [goalForClaim] = await db.select({ domain: agentDirectorGoals.domain }).from(agentDirectorGoals).where(eq(agentDirectorGoals.id, review.goalId)).limit(1);
  if (!goalForClaim) throw new AgentError('validation_error', 'Goal vinculado à review não foi encontrado.');

  // --- claim atômico (INSERT ... ON CONFLICT DO NOTHING, sem transação) ---
  const claimed = await db
    .insert(agentStrategicMemories)
    .values({
      memoryType: 'initiative_outcome',
      domain: goalForClaim.domain,
      sourceGoalId: review.goalId,
      sourceInitiativeId: review.initiativeId,
      sourceReviewId: review.id,
      status: 'draft',
      evidence: {},
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    // `where` (não `targetWhere`, exclusivo de onConflictDoUpdate) repete
    // o predicado do índice parcial — mesmo bug já documentado/corrigido
    // em reviews/review-service.ts e initiatives-service.ts (v2.2):
    // sem isso, "there is no unique or exclusion constraint matching the
    // ON CONFLICT specification".
    .onConflictDoNothing({ target: agentStrategicMemories.sourceReviewId, where: isNotNull(agentStrategicMemories.sourceReviewId) })
    .returning();

  if (claimed.length === 0) {
    const [existing] = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.sourceReviewId, review.id)).limit(1);
    if (!existing) throw new AgentError('conflict', 'Falha ao localizar memória estratégica após conflito de criação — tente novamente.');

    if (existing.status !== 'draft') {
      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.director.memory.reused',
        entityType: 'agent_strategic_memory',
        entityId: String(existing.id),
        metadata: { sourceReviewId: review.id, sourceGoalId: review.goalId, sourceInitiativeId: review.initiativeId, reason: 'idempotent_create_call' },
      });
      return { memory: existing, created: false };
    }

    const resolved = await waitForMemoryCompletion(review.id);
    return { memory: resolved, created: false };
  }

  const draft = claimed[0]!;

  await audit({
    userId: actorUserId,
    actorType: actorUserId ? 'user' : 'system',
    actorId: actorUserId ? String(actorUserId) : null,
    action: 'agents.director.memory.requested',
    entityType: 'agent_strategic_memory',
    entityId: String(draft.id),
    metadata: { sourceReviewId: review.id, sourceGoalId: review.goalId, sourceInitiativeId: review.initiativeId },
  });

  try {
    const [goal] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, review.goalId)).limit(1);
    if (!goal) throw new AgentError('validation_error', 'Goal vinculado à review não foi encontrado.');

    const [initiative] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, review.initiativeId)).limit(1);
    if (!initiative) throw new AgentError('validation_error', 'Initiative vinculada à review não foi encontrada.');

    const evidence = buildStrategicMemoryEvidence({ goal, initiative, review });

    if (!env.AGENT_LLM_ENABLED) {
      throw new AgentError('llm_unavailable', 'Geração de memória estratégica requer o LLM habilitado (AGENT_LLM_ENABLED=false).');
    }

    const extracted = await extractStrategicMemory({
      provider: getLLMProvider(),
      model: env.AGENT_LLM_MODEL,
      evidence,
      timeoutMs: env.AGENT_LLM_TIMEOUT_MS,
    });

    if (extracted.status !== 'ok' || !extracted.output) {
      throw new AgentError('memory_failed', extracted.errorMessage ?? 'Não foi possível gerar a memória estratégica a partir da evidência disponível.');
    }

    const output = extracted.output;

    const [completed] = await db
      .update(agentStrategicMemories)
      .set({
        domain: goal.domain,
        title: output.title,
        summary: output.summary,
        lesson: output.lesson,
        outcome: review.outcome,
        confidence: output.confidence.toFixed(3),
        importance: output.importance,
        tags: output.tags,
        sourceDecisionId: review.resultingDecisionId,
        evidence: evidence as unknown as Record<string, unknown>,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(agentStrategicMemories.id, draft.id))
      .returning();

    await audit({
      userId: actorUserId,
      actorType: actorUserId ? 'user' : 'system',
      actorId: actorUserId ? String(actorUserId) : null,
      action: 'agents.director.memory.created',
      entityType: 'agent_strategic_memory',
      entityId: String(draft.id),
      metadata: { sourceReviewId: review.id, sourceGoalId: review.goalId, sourceInitiativeId: review.initiativeId, importance: output.importance },
    });

    return { memory: completed!, created: true };
  } catch (error) {
    // Reverte o claim (seção 15: "não deixar registro permanentemente
    // em estado transitório") — deleta a linha draft, liberando o slot
    // único de source_review_id para uma nova tentativa.
    await db.delete(agentStrategicMemories).where(eq(agentStrategicMemories.id, draft.id));
    throw error;
  }
}

export async function getStrategicMemoryById(id: number): Promise<StrategicMemoryRow | null> {
  const [row] = await db.select().from(agentStrategicMemories).where(eq(agentStrategicMemories.id, id)).limit(1);
  return row ?? null;
}

export interface ListStrategicMemoriesParams {
  page: number;
  limit: number;
  domain?: string;
  memoryType?: MemoryType;
  status?: MemoryStatus;
  goalId?: number;
  initiativeId?: number;
}

/**
 * Agentes v2.3 (correio.md seção 18) — leitura administrativa/CRUD
 * mínima. Nunca devolve linhas `draft` por padrão — só via `status`
 * explícito (seção 18: "não criar CRUD administrativo gigantesco",
 * `draft` é um detalhe interno de concorrência, não um estado que faça
 * sentido navegar por padrão).
 */
export async function listStrategicMemories(params: ListStrategicMemoriesParams) {
  const conditions: SQL[] = [];
  if (params.domain) conditions.push(eq(agentStrategicMemories.domain, params.domain));
  if (params.memoryType) conditions.push(eq(agentStrategicMemories.memoryType, params.memoryType));
  if (params.status) conditions.push(eq(agentStrategicMemories.status, params.status));
  // `draft` nunca aparece por padrão (só se explicitamente pedido via
  // `status=draft`) — é um detalhe transitório de concorrência, não um
  // estado que faça sentido navegar/listar normalmente.
  else conditions.push(ne(agentStrategicMemories.status, 'draft'));
  if (params.goalId) conditions.push(eq(agentStrategicMemories.sourceGoalId, params.goalId));
  if (params.initiativeId) conditions.push(eq(agentStrategicMemories.sourceInitiativeId, params.initiativeId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentStrategicMemories)
      .where(where)
      .orderBy(desc(agentStrategicMemories.createdAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentStrategicMemories).where(where),
  ]);

  return { rows, total: Number(total) };
}

/**
 * Agentes v2.3 (correio.md seção 2/16) — "nunca deletar silenciosamente
 * memória estratégica relevante": arquivar é o único caminho de
 * "remoção" (soft state, mesmo padrão de `dismissDecision`/
 * `cancelInitiative`). Não exposto por rota HTTP própria nesta versão
 * (seção 18: "não criar CRUD administrativo gigantesco" — o escopo
 * pedido é criar/consultar/recuperar) — função de serviço testável
 * diretamente, pronta para ganhar endpoint quando houver necessidade
 * real comprovada.
 */
export async function archiveStrategicMemory(memory: StrategicMemoryRow, actorUserId: number): Promise<StrategicMemoryRow> {
  if (memory.status === 'archived') {
    throw new AgentError('conflict', 'Memória estratégica já está arquivada.');
  }
  if (memory.status === 'draft') {
    throw new AgentError('conflict', 'Memória estratégica ainda em geração (draft) — não pode ser arquivada.');
  }

  const [updated] = await db
    .update(agentStrategicMemories)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(agentStrategicMemories.id, memory.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.director.memory.archived',
    entityType: 'agent_strategic_memory',
    entityId: String(memory.id),
    metadata: { sourceReviewId: memory.sourceReviewId, previousStatus: memory.status },
  });

  return updated!;
}
