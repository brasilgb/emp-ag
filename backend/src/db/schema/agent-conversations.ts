import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

// status: active | archived.
export const agentConversations = pgTable(
  'agent_conversations',
  {
    id: serial('id').primaryKey(),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'cascade',
      }),

    title: varchar('title', {
      length: 200,
    }),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('active'),

    // Contexto estruturado da conversa (ex.: último agente/tool usado).
    // Nunca usado para armazenar raciocínio privado de LLM (seção 18).
    context: jsonb('context'),

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
    index('agent_conversations_user_id_idx').on(table.userId),
    index('agent_conversations_status_idx').on(table.status),
  ],
);
