import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: serial('id').primaryKey(),

    name: varchar('name', {
      length: 100,
    }).notNull(),

    slug: varchar('slug', {
      length: 50,
    })
      .notNull()
      .unique(),

    // Controla a ordenação do Kanban. A lógica interna (ganho/perdido)
    // nunca deve depender do nome visual — apenas de isWon/isLost/slug.
    position: integer('position').notNull(),

    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
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
    // Índices únicos parciais: garantem no banco que no máximo um estágio
    // pode ser o estágio "ganho" e no máximo um pode ser o "perdido".
    uniqueIndex('pipeline_stages_single_won_idx')
      .on(table.isWon)
      .where(sql`${table.isWon} = true`),
    uniqueIndex('pipeline_stages_single_lost_idx')
      .on(table.isLost)
      .where(sql`${table.isLost} = true`),
  ],
);
