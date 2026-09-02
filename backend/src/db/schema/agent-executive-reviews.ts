import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { agentActionPlans } from './agent-action-plans.js';
import { agentDirectorDecisions } from './agent-director-decisions.js';
import { agentDirectorGoals } from './agent-director-goals.js';
import { agentDirectorInitiatives } from './agent-director-initiatives.js';
import { users } from './users.js';

/**
 * Agentes v2.2 (correio.md "2. Executive Review") — avaliação executiva
 * persistente do RESULTADO ESTRATÉGICO de uma Initiative já executada,
 * separada do resultado técnico (que já vive em agent_action_plan_items,
 * derivado por `initiatives-progress.ts`). Nunca duplica execução: esta
 * tabela é só leitura + interpretação, nenhuma linha aqui jamais
 * dispara uma tool.
 *
 * `actionPlanId` é NOT NULL + UNIQUE (correio.md seção 16: "pode existir
 * inicialmente uma review canônica por Action Plan/execução" — 1:1
 * deliberado nesta versão). A unicidade É o próprio mecanismo de
 * idempotência/concorrência (seção 11): um `INSERT ... ON CONFLICT
 * (action_plan_id) DO NOTHING` é a tentativa de "claim" atômica, mesmo
 * racional já usado em `decisions/sync-service.ts:upsertSignal` — nunca
 * find-then-insert desprotegido. Evolução futura (seção 16: "não criar
 * arquitetura que impeça"): se uma segunda `reviewType` for introduzida,
 * o índice único passa a ser composto `(action_plan_id, review_type)` —
 * a coluna `reviewType` já existe desde já para isso, só não faz parte
 * do índice único enquanto houver um único tipo real.
 *
 * status: draft | completed | superseded (seção 3) — `draft` é o estado
 * transitório entre o claim e a resposta do LLM (nunca visível via GET,
 * nunca contém outcome/recommendation ainda). Uma falha do provider
 * DELETA a linha `draft` (nunca a deixa presa — seção 24 "Falha do
 * provider"), liberando o slot único para uma nova tentativa.
 *
 * outcome (seção 4): resultado ESTRATÉGICO, deliberadamente independente
 * do estado técnico da execução — só o LLM (via saída estruturada
 * validada por Zod) decide isso, nunca uma regra determinística local.
 *
 * `resultingInitiativeId`/`resultingDecisionId` (seção 10/22): vínculo
 * com o efeito colateral autorizado de uma recomendação `new_initiative`
 * (nova Initiative pelo pipeline oficial) ou `escalate` (novo Decision
 * Item pelo mecanismo já existente da v1.9) — nunca uma segunda entidade
 * equivalente criada à parte.
 */
export const agentExecutiveReviews = pgTable(
  'agent_executive_reviews',
  {
    id: serial('id').primaryKey(),

    goalId: integer('goal_id')
      .notNull()
      .references(() => agentDirectorGoals.id, { onDelete: 'cascade' }),

    initiativeId: integer('initiative_id')
      .notNull()
      .references(() => agentDirectorInitiatives.id, { onDelete: 'cascade' }),

    actionPlanId: integer('action_plan_id')
      .notNull()
      .references(() => agentActionPlans.id, { onDelete: 'cascade' }),

    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),

    reviewType: varchar('review_type', { length: 30 }).notNull().default('initiative_outcome'),

    status: varchar('status', { length: 20 }).notNull().default('draft'),

    outcome: varchar('outcome', { length: 30 }),

    summary: text('summary'),
    expectedResult: text('expected_result'),
    actualResult: text('actual_result'),

    // DTO de evidência determinística montado pelo backend (correio.md
    // seção 5/6) — o MESMO objeto enviado ao provider LLM, persistido
    // verbatim para auditoria ("o Diretor não deve simplesmente afirmar
    // que algo funcionou" — a evidência usada fica sempre rastreável).
    evidence: jsonb('evidence').notNull().default({}),

    assessment: text('assessment'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),

    recommendationType: varchar('recommendation_type', { length: 20 }),
    recommendation: jsonb('recommendation'),

    resultingInitiativeId: integer('resulting_initiative_id').references(() => agentDirectorInitiatives.id, { onDelete: 'set null' }),
    resultingDecisionId: integer('resulting_decision_id').references(() => agentDirectorDecisions.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_executive_reviews_action_plan_idx').on(table.actionPlanId),
    index('agent_executive_reviews_initiative_idx').on(table.initiativeId),
    index('agent_executive_reviews_goal_idx').on(table.goalId),
    index('agent_executive_reviews_status_idx').on(table.status),
  ],
);
