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

import { users } from './users.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    actorType: varchar('actor_type', {
      length: 30,
    }).notNull(),

    actorId: varchar('actor_id', {
      length: 100,
    }),

    action: varchar('action', {
      length: 100,
    }).notNull(),

    entityType: varchar('entity_type', {
      length: 100,
    }),

    entityId: varchar('entity_id', {
      length: 100,
    }),

    oldData: jsonb('old_data'),

    newData: jsonb('new_data'),

    metadata: jsonb('metadata'),

    ipAddress: varchar('ip_address', {
      length: 64,
    }),

    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_logs_user_id_idx').on(table.userId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_entity_idx').on(
      table.entityType,
      table.entityId,
    ),
    index('audit_logs_created_at_idx').on(
      table.createdAt,
    ),
  ],
);