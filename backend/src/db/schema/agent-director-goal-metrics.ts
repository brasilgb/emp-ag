import { index, integer, jsonb, numeric, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { agentDirectorGoals } from './agent-director-goals.js';

/**
 * Agentes v2.0 (correio.md "3. Goal Metrics" / "4. Não permitir SQL
 * arbitrário em métricas") — indicador associado a um Goal. `metricKey`
 * é obrigatoriamente uma chave do catálogo determinístico
 * (agents/director/goals/metrics/catalog.ts), nunca SQL/texto livre
 * armazenado aqui — a coluna guarda só a chave e os valores calculados,
 * o "como calcular" vive inteiramente em código versionado e testado.
 *
 * Um Goal pode ter mais de uma métrica (correio.md não restringe a uma);
 * `weight` permite compor várias métricas num único `progressPercent`
 * do Goal (ver evaluation-engine.ts) sem forçar 1:1.
 *
 * direction: increase | decrease | maintain
 */
export const agentDirectorGoalMetrics = pgTable(
  'agent_director_goal_metrics',
  {
    id: serial('id').primaryKey(),

    goalId: integer('goal_id')
      .notNull()
      .references(() => agentDirectorGoals.id, { onDelete: 'cascade' }),

    metricKey: varchar('metric_key', { length: 100 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    sourceDomain: varchar('source_domain', { length: 20 }).notNull(),

    targetValue: numeric('target_value', { precision: 18, scale: 4 }).notNull(),
    currentValue: numeric('current_value', { precision: 18, scale: 4 }),
    unit: varchar('unit', { length: 30 }),
    direction: varchar('direction', { length: 20 }).notNull().default('increase'),
    weight: integer('weight').notNull().default(1),

    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Mesmo metricKey não pode ser adicionado duas vezes ao mesmo Goal
    // (evita métricas duplicadas concorrendo pelo mesmo progressPercent).
    uniqueIndex('agent_director_goal_metrics_goal_key_idx').on(table.goalId, table.metricKey),
    index('agent_director_goal_metrics_goal_idx').on(table.goalId),
  ],
);
