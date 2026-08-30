import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';
import { users } from './users.js';

// Sem anexos nesta primeira versão.
export const taskComments = pgTable(
  'task_comments',
  {
    id: serial('id').primaryKey(),

    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'cascade',
      }),

    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    content: text('content').notNull(),

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
    index('task_comments_task_id_idx').on(table.taskId),
    index('task_comments_created_at_idx').on(table.createdAt),
  ],
);
