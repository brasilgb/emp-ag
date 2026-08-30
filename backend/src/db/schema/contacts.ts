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

import { clients } from './clients.js';

export const contacts = pgTable(
  'contacts',
  {
    id: serial('id').primaryKey(),

    // Um cliente pode ter vários contatos. onDelete cascade: nesta versão
    // não existe endpoint de exclusão de cliente, mas a integridade
    // referencial já fica explícita para quando ele existir.
    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, {
        onDelete: 'cascade',
      }),

    name: varchar('name', {
      length: 200,
    }).notNull(),

    email: varchar('email', {
      length: 255,
    }),

    phone: varchar('phone', {
      length: 32,
    }),

    position: varchar('position', {
      length: 120,
    }),

    isPrimary: boolean('is_primary')
      .notNull()
      .default(false),

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
    index('contacts_client_id_idx').on(table.clientId),
  ],
);
