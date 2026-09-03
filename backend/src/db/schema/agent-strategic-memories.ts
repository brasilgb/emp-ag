import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { agentDirectorDecisions } from './agent-director-decisions.js';
import { agentDirectorGoals } from './agent-director-goals.js';
import { agentDirectorInitiatives } from './agent-director-initiatives.js';
import { agentExecutiveReviews } from './agent-executive-reviews.js';
import { users } from './users.js';

/**
 * Agentes v2.3 (correio.md "2. Conceito de Strategic Memory") —
 * aprendizado organizacional persistente e auditável, usado
 * EXCLUSIVAMENTE como contexto consultivo (seção 0/6/8/22) — nunca
 * concede permissão, nunca autoriza, nunca executa. "Histórico pode
 * orientar uma decisão futura, mas nunca autorizar sua execução."
 *
 * `sourceReviewId` NULLABLE + índice único PARCIAL (WHERE NOT NULL):
 * nesta versão, TODA memória nasce de uma Executive Review
 * (`createStrategicMemoryFromReview`, seção 4/13 — "0 ou 1 memória
 * canônica" por review), então a coluna sempre vem preenchida na
 * prática — mas fica nullable no schema para permitir, sem migração
 * futura, outros `memory_type` não derivados de review (seção 2:
 * `strategic_lesson`/`decision_outcome`/`recurring_pattern` já
 * previstos no vocabulário, mesmo que só `initiative_outcome` seja
 * produzido nesta versão). A unicidade parcial É o próprio mecanismo de
 * idempotência/claim (seção 13/14), mesmo padrão já usado em
 * `agent_executive_reviews.action_plan_id` (v2.2) e
 * `agent_director_initiatives.recommendation_key` (v2.0). Evolução
 * futura sem redesenho: se um segundo `memory_type` por review for
 * necessário, o índice vira composto `(source_review_id, memory_type)`.
 *
 * status: draft | active | superseded | archived — `draft` é uma
 * ADIÇÃO à sugestão do correio.md (que listava só active/superseded/
 * archived), pelo MESMO motivo documentado em `agent_executive_reviews`
 * (v2.2): é o estado transitório entre o claim atômico e a resposta do
 * LLM, necessário para nunca segurar transaction durante a chamada
 * externa (seção 4/15). Nunca deletado silenciosamente (seção 2) — uma
 * falha do provider DELETA a linha `draft` (nunca fica presa — seção
 * 15), mas uma memória `active` real nunca é apagada, só arquivada.
 *
 * `tags` (jsonb, array de strings): campo adicional além dos "campos
 * mínimos" listados na seção 2 — justificado porque a seção 7 pede
 * explicitamente que a saída estruturada do LLM inclua `tags`; persistir
 * é melhor que descartar um dado real já gerado.
 */
export const agentStrategicMemories = pgTable(
  'agent_strategic_memories',
  {
    id: serial('id').primaryKey(),

    memoryType: varchar('memory_type', { length: 30 }).notNull(),
    domain: varchar('domain', { length: 20 }).notNull(),

    title: varchar('title', { length: 255 }),
    summary: text('summary'),
    lesson: text('lesson'),

    // Espelha o outcome da Executive Review de origem (só aplicável a
    // memory_type='initiative_outcome') — nunca reinterpretado, copiado
    // deterministicamente pelo backend a partir de `evidence`.
    outcome: varchar('outcome', { length: 30 }),

    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    importance: varchar('importance', { length: 10 }),
    tags: jsonb('tags').notNull().default([]),

    sourceGoalId: integer('source_goal_id')
      .notNull()
      .references(() => agentDirectorGoals.id, { onDelete: 'cascade' }),
    sourceInitiativeId: integer('source_initiative_id')
      .notNull()
      .references(() => agentDirectorInitiatives.id, { onDelete: 'cascade' }),
    sourceReviewId: integer('source_review_id').references(() => agentExecutiveReviews.id, { onDelete: 'cascade' }),
    sourceDecisionId: integer('source_decision_id').references(() => agentDirectorDecisions.id, { onDelete: 'set null' }),

    // DTO de evidência determinística (seção 5) — fatos reais, NUNCA a
    // interpretação do LLM (essa fica em title/summary/lesson/tags). O
    // backend monta este objeto ANTES de chamar o LLM, a partir da
    // Executive Review/Goal/Initiative reais — nunca escrito pelo modelo.
    evidence: jsonb('evidence').notNull().default({}),

    status: varchar('status', { length: 20 }).notNull().default('draft'),

    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_strategic_memories_source_review_idx').on(table.sourceReviewId).where(sql`${table.sourceReviewId} IS NOT NULL`),
    index('agent_strategic_memories_domain_idx').on(table.domain),
    index('agent_strategic_memories_status_idx').on(table.status),
    index('agent_strategic_memories_type_idx').on(table.memoryType),
    index('agent_strategic_memories_goal_idx').on(table.sourceGoalId),
    index('agent_strategic_memories_initiative_idx').on(table.sourceInitiativeId),
  ],
);
