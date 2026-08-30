import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { agentConversations } from './agent-conversations.js';
import { agents } from './agents.js';
import { agentTools } from './agent-tools.js';
import { users } from './users.js';

// status: pending | running | waiting_approval | approved | rejected |
// completed | failed | cancelled.
// autonomyLevel: nível efetivo usado nesta execução (read | prepare |
// execute | approval_required) — snapshot no momento da execução, pode
// divergir do default_autonomy_level atual do agente/tool no futuro.
//
// idempotencyKey (seção 48): adição além da lista literal da seção 11,
// necessária para suportar retry sem duplicar efeito em tools mutáveis
// (create_internal_task, add_internal_note,
// create_internal_followup_activity). O índice único parcial abaixo é
// quem garante isso no banco, não apenas em código.
export const agentExecutions = pgTable(
  'agent_executions',
  {
    id: serial('id').primaryKey(),

    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id, {
        onDelete: 'restrict',
      }),

    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    conversationId: integer('conversation_id').references(
      () => agentConversations.id,
      {
        onDelete: 'set null',
      },
    ),

    toolId: integer('tool_id')
      .notNull()
      .references(() => agentTools.id, {
        onDelete: 'restrict',
      }),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('pending'),

    autonomyLevel: varchar('autonomy_level', {
      length: 20,
    }).notNull(),

    input: jsonb('input'),

    output: jsonb('output'),

    error: jsonb('error'),

    idempotencyKey: varchar('idempotency_key', {
      length: 100,
    }),

    startedAt: timestamp('started_at', {
      withTimezone: true,
    }),

    finishedAt: timestamp('finished_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('agent_executions_status_idx').on(table.status),
    index('agent_executions_created_at_idx').on(table.createdAt),
    index('agent_executions_agent_id_idx').on(table.agentId),
    index('agent_executions_user_id_idx').on(table.userId),
    index('agent_executions_conversation_id_idx').on(table.conversationId),
    uniqueIndex('agent_executions_idempotency_idx')
      .on(table.agentId, table.toolId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ],
);
