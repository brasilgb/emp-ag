import {
  boolean,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// SLA simples baseado em prioridade (nunca engine sofisticada nesta v1).
// Uma linha por prioridade (unique) — "a política vigente" é sempre a linha
// ativa correspondente à prioridade do ticket no momento da criação.
// sla_due_at do ticket é calculado só a partir de resolutionMinutes;
// firstResponseMinutes fica reservado para uso futuro (ex.: alerta de SLA
// perto de vencer via n8n).
export const supportSlaPolicies = pgTable('support_sla_policies', {
  id: serial('id').primaryKey(),

  priority: varchar('priority', {
    length: 20,
  })
    .notNull()
    .unique(),

  firstResponseMinutes: integer('first_response_minutes').notNull(),

  resolutionMinutes: integer('resolution_minutes').notNull(),

  isActive: boolean('is_active').notNull().default(true),

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
});
