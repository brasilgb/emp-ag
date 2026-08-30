import {
  boolean,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),

  name: varchar('name', {
    length: 80,
  })
    .notNull()
    .unique(),

  slug: varchar('slug', {
    length: 80,
  })
    .notNull()
    .unique(),

  description: varchar('description', {
    length: 255,
  }),

  isSystem: boolean('is_system')
    .notNull()
    .default(false),

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