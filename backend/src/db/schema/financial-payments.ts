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

import { financialEntries } from './financial-entries.js';
import { users } from './users.js';

// Um lançamento (financial_entries) pode ter vários pagamentos (pagamento
// parcial). Sem DELETE nesta v1 — cascade em entryId é só para manter a
// integridade referencial caso a entry venha a ser removida futuramente.
export const financialPayments = pgTable(
  'financial_payments',
  {
    id: serial('id').primaryKey(),

    entryId: integer('entry_id')
      .notNull()
      .references(() => financialEntries.id, {
        onDelete: 'cascade',
      }),

    // Numeric, nunca float, para representar valores monetários com
    // precisão exata.
    amount: numeric('amount', {
      precision: 14,
      scale: 2,
    }).notNull(),

    paidAt: timestamp('paid_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    paymentMethod: varchar('payment_method', {
      length: 20,
    }),

    reference: varchar('reference', {
      length: 120,
    }),

    notes: text('notes'),

    createdBy: integer('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('financial_payments_entry_id_idx').on(table.entryId),
    check('financial_payments_amount_positive', sql`${table.amount} > 0`),
  ],
);
