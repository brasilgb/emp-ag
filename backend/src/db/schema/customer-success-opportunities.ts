import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients.js';
import { customerSuccessAccounts } from './customer-success-accounts.js';
import { users } from './users.js';

// type: upsell | cross_sell | renewal
// status: identified | qualified | proposed | won | lost
// Não integra automaticamente ao CRM nesta v1 — estruturado para futura
// conversão em oportunidade comercial (lead/deal).
export const customerSuccessOpportunities = pgTable(
  'customer_success_opportunities',
  {
    id: serial('id').primaryKey(),

    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, {
        onDelete: 'restrict',
      }),

    // Preenchido automaticamente (ensureCsAccount) na criação — pode ficar
    // órfão se a conta for removida no futuro (sem DELETE nesta v1).
    csAccountId: integer('cs_account_id').references(
      () => customerSuccessAccounts.id,
      { onDelete: 'set null' },
    ),

    type: varchar('type', {
      length: 20,
    }).notNull(),

    title: varchar('title', {
      length: 200,
    }).notNull(),

    description: text('description'),

    // Numeric, nunca float, para representar valores monetários com
    // precisão exata.
    estimatedValue: numeric('estimated_value', {
      precision: 14,
      scale: 2,
    }),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('identified'),

    ownerUserId: integer('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

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
    index('customer_success_opportunities_client_id_idx').on(table.clientId),
    index('customer_success_opportunities_cs_account_id_idx').on(table.csAccountId),
    index('customer_success_opportunities_status_idx').on(table.status),
    check(
      'customer_success_opportunities_estimated_value_positive',
      sql`${table.estimatedValue} IS NULL OR ${table.estimatedValue} > 0`,
    ),
  ],
);
