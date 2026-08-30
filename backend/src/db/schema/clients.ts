import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

// type: 'person' | 'company'
// status: 'active' | 'inactive'
// Validados na camada de schemas (Zod) — ver src/schemas/crm.ts.
export const clients = pgTable(
  'clients',
  {
    id: serial('id').primaryKey(),

    type: varchar('type', {
      length: 20,
    }).notNull(),

    name: varchar('name', {
      length: 200,
    }).notNull(),

    legalName: varchar('legal_name', {
      length: 200,
    }),

    // CPF/CNPJ. Sem validação fiscal nesta primeira versão.
    document: varchar('document', {
      length: 32,
    }),

    email: varchar('email', {
      length: 255,
    }),

    phone: varchar('phone', {
      length: 32,
    }),

    website: varchar('website', {
      length: 255,
    }),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('active'),

    notes: text('notes'),

    createdBy: integer('created_by').references(() => users.id, {
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
    index('clients_status_idx').on(table.status),
    index('clients_type_idx').on(table.type),
    index('clients_name_idx').on(table.name),
  ],
);
