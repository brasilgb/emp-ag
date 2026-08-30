import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients.js';
import { users } from './users.js';

// status: onboarding | active | attention | at_risk | inactive
// onboardingStatus: not_started | in_progress | completed | blocked
// churnRisk: low | medium | high
// Uma linha por cliente (clientId único). healthScore (0-100) e churnRisk
// são manuais nesta v1 — sem IA. satisfactionScore (1-5) pode ser null.
export const customerSuccessAccounts = pgTable(
  'customer_success_accounts',
  {
    id: serial('id').primaryKey(),

    clientId: integer('client_id')
      .notNull()
      .unique()
      .references(() => clients.id, {
        onDelete: 'cascade',
      }),

    ownerUserId: integer('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('onboarding'),

    // Neutro por padrão em contas criadas automaticamente — ajustado
    // manualmente depois.
    healthScore: integer('health_score').notNull().default(50),

    onboardingStatus: varchar('onboarding_status', {
      length: 20,
    })
      .notNull()
      .default('not_started'),

    lastContactAt: timestamp('last_contact_at', {
      withTimezone: true,
    }),

    nextContactAt: timestamp('next_contact_at', {
      withTimezone: true,
    }),

    satisfactionScore: integer('satisfaction_score'),

    churnRisk: varchar('churn_risk', {
      length: 20,
    })
      .notNull()
      .default('low'),

    notes: text('notes'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('customer_success_accounts_status_idx').on(table.status),
    index('customer_success_accounts_next_contact_at_idx').on(table.nextContactAt),
    index('customer_success_accounts_churn_risk_idx').on(table.churnRisk),
    check(
      'customer_success_accounts_health_score_range',
      sql`${table.healthScore} >= 0 AND ${table.healthScore} <= 100`,
    ),
    check(
      'customer_success_accounts_satisfaction_score_range',
      sql`${table.satisfactionScore} IS NULL OR (${table.satisfactionScore} >= 1 AND ${table.satisfactionScore} <= 5)`,
    ),
  ],
);
