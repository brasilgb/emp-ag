import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { supportTickets } from './support-tickets.js';
import { users } from './users.js';

// type: 'message' | 'note' | 'system'
// isInternal: false = comunicação que futuramente pode ser mostrada ao
// cliente (sem portal do cliente nesta v1); true = nota interna da equipe.
export const supportMessages = pgTable(
  'support_messages',
  {
    id: serial('id').primaryKey(),

    ticketId: integer('ticket_id')
      .notNull()
      .references(() => supportTickets.id, {
        onDelete: 'cascade',
      }),

    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    type: varchar('type', {
      length: 20,
    })
      .notNull()
      .default('message'),

    content: text('content').notNull(),

    isInternal: boolean('is_internal').notNull().default(false),

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
  (table) => [index('support_messages_ticket_id_idx').on(table.ticketId)],
);
