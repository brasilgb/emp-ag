import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { customerSuccessAccounts } from './customer-success-accounts.js';
import { users } from './users.js';

// type: onboarding | follow_up | meeting | training | satisfaction |
//       renewal | upsell | cross_sell | risk | note
// Mesma forma de crm_activities. Toda atividade criada atualiza
// customer_success_accounts.last_contact_at (ver src/routes/customer-success/helpers.ts).
export const customerSuccessActivities = pgTable(
  'customer_success_activities',
  {
    id: serial('id').primaryKey(),

    csAccountId: integer('cs_account_id')
      .notNull()
      .references(() => customerSuccessAccounts.id, {
        onDelete: 'cascade',
      }),

    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    type: varchar('type', {
      length: 30,
    }).notNull(),

    title: varchar('title', {
      length: 200,
    }).notNull(),

    description: text('description'),

    metadata: jsonb('metadata'),

    occurredAt: timestamp('occurred_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('customer_success_activities_cs_account_id_idx').on(table.csAccountId),
    index('customer_success_activities_occurred_at_idx').on(table.occurredAt),
  ],
);
