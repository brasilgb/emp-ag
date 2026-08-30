import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { supportTickets } from './support-tickets.js';

// event: ticket.created | ticket.updated | ticket.status_changed |
//        ticket.priority_changed | ticket.assigned | ticket.first_response |
//        ticket.resolved | ticket.closed | ticket.reopened |
//        ticket.message.created | ticket.note.created
//
// Histórico específico do ticket (append-only, sem updatedAt — mesmo
// formato de task_history). A auditoria global continua sendo gravada em
// audit_logs em paralelo, através de src/services/audit.ts.
export const supportTicketHistory = pgTable(
  'support_ticket_history',
  {
    id: serial('id').primaryKey(),

    ticketId: integer('ticket_id')
      .notNull()
      .references(() => supportTickets.id, {
        onDelete: 'cascade',
      }),

    actorType: varchar('actor_type', {
      length: 30,
    }).notNull(),

    actorId: varchar('actor_id', {
      length: 100,
    }),

    event: varchar('event', {
      length: 50,
    }).notNull(),

    oldData: jsonb('old_data'),

    newData: jsonb('new_data'),

    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('support_ticket_history_ticket_id_idx').on(table.ticketId),
    index('support_ticket_history_event_idx').on(table.event),
    index('support_ticket_history_created_at_idx').on(table.createdAt),
  ],
);
