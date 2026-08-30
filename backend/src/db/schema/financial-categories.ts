import {
  boolean,
  index,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// type: 'income' | 'expense' | 'both'
// Validado na camada de schemas (Zod) — ver src/schemas/financial.ts.
// Categorias de sistema (is_system = true) vêm do seed e não podem ter
// is_active alterado para false via PATCH (ver routes/financial/categories.ts).
export const financialCategories = pgTable(
  'financial_categories',
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

    type: varchar('type', {
      length: 20,
    }).notNull(),

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
    index('financial_categories_type_idx').on(table.type),
    index('financial_categories_is_active_idx').on(table.isActive),
  ],
);
