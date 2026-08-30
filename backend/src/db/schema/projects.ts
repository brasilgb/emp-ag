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
import { users } from './users.js';

// status: draft | planned | in_progress | on_hold | completed | cancelled
// priority: low | normal | high | urgent
// Validados na camada de schemas (Zod) — ver src/schemas/projects.ts. Não
// depender do nome visual desses valores para nenhuma regra interna.
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),

    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, {
        onDelete: 'restrict',
      }),

    name: varchar('name', {
      length: 200,
    }).notNull(),

    description: text('description'),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('draft'),

    priority: varchar('priority', {
      length: 20,
    })
      .notNull()
      .default('normal'),

    ownerUserId: integer('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    startDate: date('start_date', { mode: 'string' }),

    dueDate: date('due_date', { mode: 'string' }),

    completedAt: timestamp('completed_at', {
      withTimezone: true,
    }),

    // Numeric, nunca float, para representar valores monetários com
    // precisão exata.
    estimatedValue: numeric('estimated_value', {
      precision: 14,
      scale: 2,
    }),

    estimatedHours: numeric('estimated_hours', {
      precision: 6,
      scale: 2,
    }),

    // Calculado automaticamente pelo backend a partir das tarefas concluídas
    // (tarefas concluídas / tarefas totais, excluindo cancelled). Nunca
    // aceito diretamente via payload de create/update — ver
    // src/schemas/projects.ts e recalcProjectProgress() em
    // src/routes/projects/helpers.ts.
    progress: integer('progress').notNull().default(0),

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
    index('projects_status_idx').on(table.status),
    index('projects_priority_idx').on(table.priority),
    index('projects_client_id_idx').on(table.clientId),
    index('projects_owner_user_id_idx').on(table.ownerUserId),
    index('projects_due_date_idx').on(table.dueDate),
    check(
      'projects_progress_range',
      sql`${table.progress} >= 0 AND ${table.progress} <= 100`,
    ),
  ],
);
