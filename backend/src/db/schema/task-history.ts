import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { tasks } from './tasks.js';

// event: task.created | task.updated | task.status_changed |
//        task.assignee_changed | task.priority_changed | task.completed |
//        task.reopened
//
// Histórico específico da tarefa (append-only, sem updatedAt — como
// audit_logs). A auditoria global continua sendo gravada em audit_logs em
// paralelo, através de src/services/audit.ts.
export const taskHistory = pgTable(
  'task_history',
  {
    id: serial('id').primaryKey(),

    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id, {
        onDelete: 'cascade',
      }),

    actorType: varchar('actor_type', {
      length: 30,
    }).notNull(),

    actorId: varchar('actor_id', {
      length: 100,
    }),

    event: varchar('event', {
      length: 50,
    }).notNull(),

    oldData: jsonb('old_data'),

    newData: jsonb('new_data'),

    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('task_history_task_id_idx').on(table.taskId),
    index('task_history_event_idx').on(table.event),
    index('task_history_created_at_idx').on(table.createdAt),
  ],
);
