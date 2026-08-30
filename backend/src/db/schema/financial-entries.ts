import { sql } from 'drizzle-orm';
import {
  check,
  date,
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
import { financialCategories } from './financial-categories.js';
import { projects } from './projects.js';
import { users } from './users.js';

// type: 'income' | 'expense'
// status: 'pending' | 'paid' | 'cancelled' — real, persistido. "overdue" NÃO
// é um status armazenado: é sempre derivado (status = 'pending' AND
// due_date < CURRENT_DATE), calculado nas rotas de leitura. Ver
// src/routes/financial/helpers.ts.
// paymentMethod: string controlada nesta v1 (ver src/schemas/financial.ts),
// sem tabela separada.
export const financialEntries = pgTable(
  'financial_entries',
  {
    id: serial('id').primaryKey(),

    type: varchar('type', {
      length: 20,
    }).notNull(),

    categoryId: integer('category_id')
      .notNull()
      .references(() => financialCategories.id, {
        onDelete: 'restrict',
      }),

    // Pode ser null para despesas internas (sem cliente associado).
    clientId: integer('client_id').references(() => clients.id, {
      onDelete: 'set null',
    }),

    // Se informado, deve pertencer ao mesmo cliente (validado na rota).
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),

    description: varchar('description', {
      length: 255,
    }).notNull(),

    // Numeric, nunca float, para representar valores monetários com
    // precisão exata.
    amount: numeric('amount', {
      precision: 14,
      scale: 2,
    }).notNull(),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('pending'),

    issueDate: date('issue_date', { mode: 'string' }).notNull(),

    dueDate: date('due_date', { mode: 'string' }).notNull(),

    // Preenchido automaticamente ao quitar o lançamento (paidAmount >=
    // amount) — nunca setado diretamente via payload de create/update. Ver
    // settleEntryPayment() em src/routes/financial/helpers.ts.
    paidAt: timestamp('paid_at', {
      withTimezone: true,
    }),

    // Período econômico do lançamento — pode divergir de issue_date/due_date
    // (ex.: receita referente a agosto, paga em setembro).
    competenceDate: date('competence_date', { mode: 'string' }).notNull(),

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

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('financial_entries_type_idx').on(table.type),
    index('financial_entries_status_idx').on(table.status),
    index('financial_entries_due_date_idx').on(table.dueDate),
    index('financial_entries_competence_date_idx').on(table.competenceDate),
    index('financial_entries_client_id_idx').on(table.clientId),
    index('financial_entries_project_id_idx').on(table.projectId),
    index('financial_entries_category_id_idx').on(table.categoryId),
    check('financial_entries_amount_positive', sql`${table.amount} > 0`),
  ],
);
