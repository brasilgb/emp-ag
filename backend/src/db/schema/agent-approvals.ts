import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { agentExecutions } from './agent-executions.js';
import { agents } from './agents.js';
import { users } from './users.js';

// status: pending | approved | rejected | expired | cancelled.
//
// Índice único em execution_id (adição sem novo campo, além da lista
// literal da seção 12): garante a relação 1:1 entre execução e
// solicitação de aprovação, suporte ao lock otimista (SELECT ... FOR
// UPDATE) usado para garantir que a execução ocorre exatamente uma vez
// mesmo sob aprovação concorrente.
export const agentApprovals = pgTable(
  'agent_approvals',
  {
    id: serial('id').primaryKey(),

    executionId: integer('execution_id')
      .notNull()
      .references(() => agentExecutions.id, {
        onDelete: 'cascade',
      }),

    requestedByAgentId: integer('requested_by_agent_id').references(
      () => agents.id,
      {
        onDelete: 'set null',
      },
    ),

    requestedForUserId: integer('requested_for_user_id').references(
      () => users.id,
      {
        onDelete: 'set null',
      },
    ),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('pending'),

    reason: text('reason'),

    requestPayload: jsonb('request_payload'),

    decisionPayload: jsonb('decision_payload'),

    approvedByUserId: integer('approved_by_user_id').references(
      () => users.id,
      {
        onDelete: 'set null',
      },
    ),

    decidedAt: timestamp('decided_at', {
      withTimezone: true,
    }),

    expiresAt: timestamp('expires_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_approvals_execution_id_idx').on(table.executionId),
    index('agent_approvals_status_idx').on(table.status),
  ],
);
