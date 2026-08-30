import {
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),

  name: varchar('name', {
    length: 120,
  }).notNull(),

  slug: varchar('slug', {
    length: 120,
  })
    .notNull()
    .unique(),

  description: varchar('description', {
    length: 255,
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
});