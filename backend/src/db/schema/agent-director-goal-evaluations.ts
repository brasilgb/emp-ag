import { index, integer, jsonb, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

import { agentDirectorGoals } from './agent-director-goals.js';

/**
 * Agentes v2.0 (correio.md "7. Goal Evaluation History") — histórico
 * append-only de cada `evaluateDirectorGoal()`. Nunca sobrescrito/
 * atualizado — só inserido. `metricSnapshot`/`factors` guardam os
 * valores exatos usados naquele momento (explicabilidade + base para
 * tendência/gráfico no frontend, seção 18, sem recalcular o passado).
 */
export const agentDirectorGoalEvaluations = pgTable(
  'agent_director_goal_evaluations',
  {
    id: serial('id').primaryKey(),

    goalId: integer('goal_id')
      .notNull()
      .references(() => agentDirectorGoals.id, { onDelete: 'cascade' }),

    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
    progressPercent: integer('progress_percent').notNull(),
    health: varchar('health', { length: 20 }).notNull(),

    metricSnapshot: jsonb('metric_snapshot').notNull().default([]),
    factors: jsonb('factors').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_director_goal_evaluations_goal_idx').on(table.goalId),
    index('agent_director_goal_evaluations_evaluated_at_idx').on(table.evaluatedAt),
  ],
);
