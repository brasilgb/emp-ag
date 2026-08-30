import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { agentConversations } from './agent-conversations.js';
import { agentMessages } from './agent-messages.js';
import { users } from './users.js';

// v1.1 — LLM Interpreter + Shadow Mode (seção 11 do correio v1.1).
// mode: shadow | fallback. error: {code, message} (timeout |
// provider_error | invalid_output | ...) ou null. Nunca armazena
// raciocínio interno do modelo — só a decisão estruturada final (mesmo
// princípio da seção 18 da v1 para agent_messages).
//
// humanVerdict/reviewedByUserId/reviewedAt (seção 30): feedback humano
// simples sobre uma interpretação, só para avaliação — não treina o
// modelo automaticamente.
export const agentInterpretations = pgTable(
  'agent_interpretations',
  {
    id: serial('id').primaryKey(),

    conversationId: integer('conversation_id')
      .notNull()
      .references(() => agentConversations.id, {
        onDelete: 'cascade',
      }),

    messageId: integer('message_id').references(() => agentMessages.id, {
      onDelete: 'set null',
    }),

    deterministicAgent: varchar('deterministic_agent', {
      length: 50,
    }),

    deterministicTool: varchar('deterministic_tool', {
      length: 150,
    }),

    llmAgent: varchar('llm_agent', {
      length: 50,
    }),

    llmTool: varchar('llm_tool', {
      length: 150,
    }),

    llmArguments: jsonb('llm_arguments'),

    llmConfidence: numeric('llm_confidence', {
      precision: 4,
      scale: 3,
    }),

    matched: boolean('matched'),

    mode: varchar('mode', {
      length: 20,
    }).notNull(),

    latencyMs: integer('latency_ms'),

    provider: varchar('provider', {
      length: 50,
    }),

    model: varchar('model', {
      length: 100,
    }),

    error: jsonb('error'),

    humanVerdict: varchar('human_verdict', {
      length: 20,
    }),

    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    reviewedAt: timestamp('reviewed_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('agent_interpretations_conversation_id_idx').on(table.conversationId),
    index('agent_interpretations_mode_idx').on(table.mode),
    index('agent_interpretations_matched_idx').on(table.matched),
    index('agent_interpretations_created_at_idx').on(table.createdAt),
  ],
);
