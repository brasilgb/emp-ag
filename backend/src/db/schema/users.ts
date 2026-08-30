import {
  boolean,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { roles } from './roles.js';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),

  name: varchar('name', {
    length: 150,
  }).notNull(),

  email: varchar('email', {
    length: 255,
  })
    .notNull()
    .unique(),

  passwordHash: varchar('password_hash', {
    length: 255,
  }).notNull(),

  roleId: integer('role_id')
    .notNull()
    .references(() => roles.id, {
      onDelete: 'restrict',
    }),

  isActive: boolean('is_active')
    .notNull()
    .default(true),

  lastLoginAt: timestamp('last_login_at', {
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
});