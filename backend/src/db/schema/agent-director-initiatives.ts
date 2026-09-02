import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { agentActionPlans } from './agent-action-plans.js';
import { agentDirectorGoals } from './agent-director-goals.js';
import { users } from './users.js';

/**
 * Agentes v2.0 (correio.md "8. Initiatives") — linha de atuação criada
 * para ajudar a alcançar um Goal. "Initiative não é Action Plan. Ela é
 * um objeto executivo de acompanhamento" — nenhum executor próprio;
 * quando há algo executável, `POST /initiatives/:id/propose` chama o
 * MESMO pipeline oficial (`planEvaluateAndPersistActionPlan` +
 * `executeActionPlan`) que toda a v1.2/v1.8/v1.9 já usa.
 *
 * `actionPlanId` (nullable, FK): "no máximo um Action Plan ativo
 * inicialmente" (correio.md seção 9) — modelado como 1:1 nesta versão;
 * approval segue derivado da MESMA cadeia real já usada pela v1.9
 * (initiative.actionPlanId → agent_action_plan_items → agent_approvals),
 * nunca uma coluna approval duplicada aqui.
 *
 * origin: manual | director_recommendation
 * `recommendationKey` (nullable, único por Goal quando presente): chave
 * de deduplicação das recomendações geradas por `reviewDirectorGoals()`
 * (correio.md seção 11: "uma mesma condição não deve gerar dezenas de
 * initiatives equivalentes") — mesmo padrão de índice parcial já usado
 * em agent-operational-settings.ts/agent-director-decisions.ts. Nunca
 * preenchido para `origin='manual'`.
 *
 * status: proposed | approved | active | blocked | completed | cancelled
 */
export const agentDirectorInitiatives = pgTable(
  'agent_director_initiatives',
  {
    id: serial('id').primaryKey(),

    goalId: integer('goal_id')
      .notNull()
      .references(() => agentDirectorGoals.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    domain: varchar('domain', { length: 20 }).notNull(),

    status: varchar('status', { length: 20 }).notNull().default('proposed'),
    priority: varchar('priority', { length: 20 }).notNull().default('medium'),

    rationale: text('rationale').notNull(),
    expectedImpact: text('expected_impact'),

    origin: varchar('origin', { length: 30 }).notNull().default('manual'),
    recommendationKey: varchar('recommendation_key', { length: 300 }),

    ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),

    actionPlanId: integer('action_plan_id').references(() => agentActionPlans.id, { onDelete: 'set null' }),

    startedAt: timestamp('started_at', { withTimezone: true }),
    targetDate: timestamp('target_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_director_initiatives_goal_idx').on(table.goalId),
    index('agent_director_initiatives_status_idx').on(table.status),
    index('agent_director_initiatives_owner_idx').on(table.ownerUserId),
    uniqueIndex('agent_director_initiatives_recommendation_idx')
      .on(table.goalId, table.recommendationKey)
      .where(sql`${table.recommendationKey} IS NOT NULL`),
  ],
);
