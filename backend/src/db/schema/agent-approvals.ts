import { sql } from 'drizzle-orm';
import {
  check,
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

import { agentActionPlanItems } from './agent-action-plan-items.js';
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
//
// Agentes v1.2 (correio.md seção 5): esta mesma tabela agora também serve
// de fila de aprovação para itens de Action Plan (agent_action_plan_items)
// — reaproveitada em vez de criar uma tabela paralela, para manter uma
// única fila/histórico de aprovações e um único par de endpoints
// (GET /agents/approvals, POST /agents/approvals/:id/approve|reject,
// ver agents/execution/approvals.ts e agents/executor/plan-approvals.ts).
// `execution_id` virou opcional e `plan_item_id` foi adicionado — em toda
// linha, exatamente um dos dois está preenchido: garantido em código pelos
// dois pontos de criação (execution/pipeline.ts e
// agents/orchestration/create-action-plan.ts) E, a partir da v1.3
// (correio.md seção 2 — "hardening"), por um CHECK constraint no banco —
// nunca depender só da validação TypeScript.
export const agentApprovals = pgTable(
  'agent_approvals',
  {
    id: serial('id').primaryKey(),

    executionId: integer('execution_id').references(() => agentExecutions.id, {
      onDelete: 'cascade',
    }),

    planItemId: integer('plan_item_id').references(() => agentActionPlanItems.id, {
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
    // Unique simples (não parcial): no Postgres, NULL nunca é igual a
    // NULL num índice único — múltiplas linhas de aprovação de item de
    // plano (execution_id NULL) convivem sem conflito, exatamente como
    // múltiplas linhas de aprovação de execução única (plan_item_id NULL)
    // no índice abaixo.
    uniqueIndex('agent_approvals_execution_id_idx').on(table.executionId),
    uniqueIndex('agent_approvals_plan_item_id_idx').on(table.planItemId),
    index('agent_approvals_status_idx').on(table.status),
    check(
      'agent_approvals_exactly_one_target',
      sql`(${table.executionId} IS NOT NULL AND ${table.planItemId} IS NULL) OR (${table.executionId} IS NULL AND ${table.planItemId} IS NOT NULL)`,
    ),
  ],
);
