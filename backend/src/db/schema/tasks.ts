import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { projectMilestones } from './project-milestones.js';
import { projects } from './projects.js';
import { users } from './users.js';

// status: backlog | todo | in_progress | blocked | review | done | cancelled
// priority: low | normal | high | urgent
// executionType: human | agent | external
//
// Nota de segurança futura (não implementada nesta versão): executionType =
// 'agent' NÃO significa execução automática. Qualquer execução futura por
// agente/Claude deve respeitar permissões, approval workflow, auditoria e
// limites de ferramentas. executionRef é texto livre reservado para uma
// referência futura (ex.: "agent:developer", "claude", "worker:xyz") — hoje
// não está associado a nenhuma automação.
export const tasks = pgTable(
  'tasks',
  {
    id: serial('id').primaryKey(),

    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, {
        onDelete: 'cascade',
      }),

    milestoneId: integer('milestone_id').references(
      () => projectMilestones.id,
      { onDelete: 'set null' },
    ),

    title: varchar('title', {
      length: 200,
    }).notNull(),

    description: text('description'),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('todo'),

    priority: varchar('priority', {
      length: 20,
    })
      .notNull()
      .default('normal'),

    assigneeUserId: integer('assignee_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    executionType: varchar('execution_type', {
      length: 20,
    })
      .notNull()
      .default('human'),

    executionRef: varchar('execution_ref', {
      length: 255,
    }),

    dueDate: date('due_date', { mode: 'string' }),

    startedAt: timestamp('started_at', {
      withTimezone: true,
    }),

    completedAt: timestamp('completed_at', {
      withTimezone: true,
    }),

    estimatedHours: numeric('estimated_hours', {
      precision: 6,
      scale: 2,
    }),

    actualHours: numeric('actual_hours', {
      precision: 6,
      scale: 2,
    }),

    // Controla a ordenação dentro do projeto/coluna do board.
    position: integer('position').notNull().default(0),

    createdBy: integer('created_by').references(() => users.id, {
      onDelete: 'set null',
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
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_milestone_id_idx').on(table.milestoneId),
    index('tasks_status_idx').on(table.status),
    index('tasks_priority_idx').on(table.priority),
    index('tasks_assignee_user_id_idx').on(table.assigneeUserId),
    index('tasks_due_date_idx').on(table.dueDate),
  ],
);
