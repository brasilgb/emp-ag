import {
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { projects } from './projects.js';

// status: pending | in_progress | completed | cancelled
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: serial('id').primaryKey(),

    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, {
        onDelete: 'cascade',
      }),

    name: varchar('name', {
      length: 200,
    }).notNull(),

    description: text('description'),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('pending'),

    // Controla a ordenação dentro do projeto.
    position: integer('position').notNull().default(0),

    dueDate: date('due_date', { mode: 'string' }),

    completedAt: timestamp('completed_at', {
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
    index('project_milestones_project_id_idx').on(table.projectId),
    index('project_milestones_status_idx').on(table.status),
  ],
);
