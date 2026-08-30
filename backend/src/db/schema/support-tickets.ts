import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients.js';
import { projects } from './projects.js';
import { supportCategories } from './support-categories.js';
import { users } from './users.js';

// status: open | triage | in_progress | waiting_customer | waiting_internal
//         | resolved | closed | cancelled
// priority: low | normal | high | critical
// source: manual | email | whatsapp | phone | website | internal | other
// Validados na camada de schemas (Zod) — ver src/schemas/support.ts.
// "overdue" NUNCA é armazenado: é sempre derivado (sla_due_at < now() AND
// status NOT IN (resolved, closed, cancelled)) — ver
// src/routes/support/helpers.ts.
export const supportTickets = pgTable(
  'support_tickets',
  {
    id: serial('id').primaryKey(),

    clientId: integer('client_id')
      .notNull()
      .references(() => clients.id, {
        onDelete: 'restrict',
      }),

    // Se informado, deve pertencer ao mesmo cliente (validado na rota).
    projectId: integer('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),

    categoryId: integer('category_id')
      .notNull()
      .references(() => supportCategories.id, {
        onDelete: 'restrict',
      }),

    title: varchar('title', {
      length: 255,
    }).notNull(),

    description: text('description'),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('open'),

    priority: varchar('priority', {
      length: 20,
    })
      .notNull()
      .default('normal'),

    source: varchar('source', {
      length: 20,
    })
      .notNull()
      .default('manual'),

    ownerUserId: integer('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    openedByUserId: integer('opened_by_user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'set null',
      }),

    // Preenchido uma única vez pela primeira mensagem de atendimento
    // (type = 'message', não 'note'/'system') — nunca sobrescrito depois.
    firstResponseAt: timestamp('first_response_at', {
      withTimezone: true,
    }),

    resolvedAt: timestamp('resolved_at', {
      withTimezone: true,
    }),

    closedAt: timestamp('closed_at', {
      withTimezone: true,
    }),

    resolution: text('resolution'),

    // Calculado na criação a partir da política de SLA vigente para a
    // prioridade do ticket. Nunca recalculado se a política mudar depois.
    slaDueAt: timestamp('sla_due_at', {
      withTimezone: true,
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
    index('support_tickets_status_idx').on(table.status),
    index('support_tickets_priority_idx').on(table.priority),
    index('support_tickets_client_id_idx').on(table.clientId),
    index('support_tickets_project_id_idx').on(table.projectId),
    index('support_tickets_owner_user_id_idx').on(table.ownerUserId),
    index('support_tickets_sla_due_at_idx').on(table.slaDueAt),
    index('support_tickets_category_id_idx').on(table.categoryId),
  ],
);
