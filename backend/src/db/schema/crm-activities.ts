import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients.js';
import { leads } from './leads.js';
import { users } from './users.js';

// type: note | call | email | meeting | whatsapp | follow_up |
//       status_change | conversion | system
export const crmActivities = pgTable(
  'crm_activities',
  {
    id: serial('id').primaryKey(),

    leadId: integer('lead_id').references(() => leads.id, {
      onDelete: 'cascade',
    }),

    clientId: integer('client_id').references(() => clients.id, {
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
    index('crm_activities_lead_id_idx').on(table.leadId),
    index('crm_activities_client_id_idx').on(table.clientId),
    index('crm_activities_occurred_at_idx').on(table.occurredAt),
    check(
      'crm_activities_lead_or_client_present',
      sql`${table.leadId} IS NOT NULL OR ${table.clientId} IS NOT NULL`,
    ),
  ],
);
