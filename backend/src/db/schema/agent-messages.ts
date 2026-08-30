import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { agentConversations } from './agent-conversations.js';
import { agents } from './agents.js';

// role: user | assistant | system | tool.
//
// Nunca persistir raciocínio privado de LLM (seção 18) — apenas mensagem
// do usuário, resposta final, tool escolhida, parâmetros, resultado da
// tool, erro e decisão de aprovação. Não existe campo chain_of_thought /
// reasoning_trace / internal_reasoning nesta tabela.
export const agentMessages = pgTable(
  'agent_messages',
  {
    id: serial('id').primaryKey(),

    conversationId: integer('conversation_id')
      .notNull()
      .references(() => agentConversations.id, {
        onDelete: 'cascade',
      }),

    agentId: integer('agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),

    role: varchar('role', {
      length: 20,
    }).notNull(),

    content: text('content').notNull(),

    // Ex.: { toolHandler, executionId } para transparência de tool
    // (seção 42), nunca detalhes internos sensíveis.
    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('agent_messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);
