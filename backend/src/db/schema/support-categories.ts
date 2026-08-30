import {
  boolean,
  index,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// defaultPriority: 'low' | 'normal' | 'high' | 'critical' — só uma sugestão
// inicial usada em POST /support/tickets quando priority não vem no
// payload. Validado na camada de schemas (Zod) — ver
// src/schemas/support.ts. Categorias de sistema (is_system = true) vêm do
// seed e não podem ter is_active alterado para false via PATCH (mesma regra
// de financial_categories).
export const supportCategories = pgTable(
  'support_categories',
  {
    id: serial('id').primaryKey(),

    name: varchar('name', {
      length: 120,
    }).notNull(),

    slug: varchar('slug', {
      length: 60,
    })
      .notNull()
      .unique(),

    description: text('description'),

    defaultPriority: varchar('default_priority', {
      length: 20,
    })
      .notNull()
      .default('normal'),

    isSystem: boolean('is_system').notNull().default(false),
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
  },
  (table) => [
    index('support_categories_is_active_idx').on(table.isActive),
  ],
);
