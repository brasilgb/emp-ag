import { index, integer, jsonb, numeric, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * Agentes v2.0 (correio.md "2. Strategic Goal") — objetivo estratégico
 * definido pelo CEO/Diretor. Camada acima da Director Decision Queue
 * (v1.9): enquanto um Decision Item representa "esta situação merece
 * acompanhamento", um Goal representa "isto é o que a empresa está
 * tentando alcançar" — nenhuma das duas camadas concede autorização de
 * execução (correio.md seção 21: "health/priority nunca aumentam
 * privilégio").
 *
 * `currentValue`/`progressPercent`/`health` são persistidos (calculados
 * por `evaluateDirectorGoal()`, nunca escritos diretamente pela rota) —
 * mesma decisão consciente de "persistir vs. derivar" já documentada em
 * agent-director-decisions.ts: aging/tendência só mudam quando a
 * avaliação roda de novo, então recalcular em toda leitura seria
 * trabalho redundante sem ganho de precisão.
 *
 * status: draft | active | paused | achieved | missed | cancelled
 * health: on_track | attention | at_risk | critical | unknown
 * targetType: metric | milestone — 'metric' usa agent_director_goal_metrics
 * para calcular currentValue/progressPercent; 'milestone' é acompanhado
 * manualmente (progressPercent atualizado por PATCH, sem métrica).
 */
export const agentDirectorGoals = pgTable(
  'agent_director_goals',
  {
    id: serial('id').primaryKey(),

    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),
    domain: varchar('domain', { length: 20 }).notNull(),

    status: varchar('status', { length: 20 }).notNull().default('draft'),
    priority: varchar('priority', { length: 20 }).notNull().default('medium'),

    ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    targetDate: timestamp('target_date', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    targetType: varchar('target_type', { length: 20 }).notNull().default('metric'),
    targetValue: numeric('target_value', { precision: 18, scale: 4 }),
    currentValue: numeric('current_value', { precision: 18, scale: 4 }),
    unit: varchar('unit', { length: 30 }),

    progressPercent: integer('progress_percent').notNull().default(0),
    health: varchar('health', { length: 20 }).notNull().default('unknown'),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }),

    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_director_goals_status_idx').on(table.status),
    index('agent_director_goals_health_idx').on(table.health),
    index('agent_director_goals_domain_idx').on(table.domain),
    index('agent_director_goals_owner_idx').on(table.ownerUserId),
    index('agent_director_goals_target_date_idx').on(table.targetDate),
  ],
);
