import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { agentJobs } from './agent-jobs.js';
import { users } from './users.js';

// Agentes v1.4 (correio.md seção 5) — associa um event_type a um Job.
// `event_type`/`event_version` são varchar/integer validados em código
// contra o catálogo (agents/events/catalog.ts) — nunca FK para uma
// "tabela de catálogo", porque o catálogo é código, não dado (mesmo
// princípio do tool-registry desde a v1: nunca confiar em algo do banco
// para decidir o que é uma tool/evento válido). `filters` é sempre
// validado tanto estruturalmente (agents/events/filters.ts) quanto contra
// os `filterableFields` do event_type escolhido antes de gravar.
export const agentEventRules = pgTable(
  'agent_event_rules',
  {
    id: serial('id').primaryKey(),

    name: varchar('name', { length: 150 }).notNull(),

    description: text('description'),

    eventType: varchar('event_type', { length: 100 }).notNull(),

    eventVersion: integer('event_version').notNull().default(1),

    jobId: integer('job_id')
      .notNull()
      .references(() => agentJobs.id, { onDelete: 'cascade' }),

    filters: jsonb('filters').notNull().default({}),

    enabled: boolean('enabled').notNull().default(true),

    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_event_rules_event_type_idx').on(table.eventType),
    index('agent_event_rules_job_id_idx').on(table.jobId),
    index('agent_event_rules_enabled_idx').on(table.enabled),
  ],
);
