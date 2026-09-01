import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { agentActionPlans } from './agent-action-plans.js';
import { agentTools } from './agent-tools.js';
import { agents } from './agents.js';

// Agentes v1.2 (correio.md seções 5/6) — uma ação dentro de um Action
// Plan.
//
// action_id/dependencies: adições além da lista literal da seção 5,
// necessárias para o executor resolver a ordem de dependências e o
// contexto entre ações (seção 10) sem reprocessar o Action Plan bruto do
// LLM a cada execução — mesmo racional de idempotencyKey em
// agent_executions (v1.1): campo extra que sustenta um requisito
// funcional explícito do plano, não dado novo de negócio.
//
// agent_id/tool_id: agent/tool já resolvidos e validados por
// planner/validator.ts no momento da criação do plano — nunca
// reinterpretados a partir da string `tool` pelo executor (mesmo
// princípio de nunca confiar de novo em dado já validado vindo do LLM).
//
// decision: execute | approval_required | blocked | shadow (saída do
// Action Policy Evaluator, imutável após a avaliação inicial).
//
// execution_status: pending | waiting_approval | approved | executing |
// completed | failed | blocked | rejected | skipped.
export const agentActionPlanItems = pgTable(
  'agent_action_plan_items',
  {
    id: serial('id').primaryKey(),

    planId: integer('plan_id')
      .notNull()
      .references(() => agentActionPlans.id, { onDelete: 'cascade' }),

    sequence: integer('sequence').notNull(),

    actionId: varchar('action_id', { length: 50 }).notNull(),

    agent: varchar('agent', { length: 50 }).notNull(),

    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),

    tool: varchar('tool', { length: 150 }).notNull(),

    toolId: integer('tool_id')
      .notNull()
      .references(() => agentTools.id, { onDelete: 'restrict' }),

    arguments: jsonb('arguments').notNull(),

    dependencies: jsonb('dependencies'),

    reason: text('reason'),

    confidence: numeric('confidence', { precision: 4, scale: 3 }),

    risk: varchar('risk', { length: 10 }).notNull(),

    decision: varchar('decision', { length: 20 }).notNull(),

    decisionReason: text('decision_reason'),

    executionStatus: varchar('execution_status', {
      length: 20,
    })
      .notNull()
      .default('pending'),

    result: jsonb('result'),

    error: jsonb('error'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    executedAt: timestamp('executed_at', {
      withTimezone: true,
    }),
  },
  (table) => [
    index('agent_action_plan_items_plan_id_idx').on(table.planId),
    index('agent_action_plan_items_execution_status_idx').on(table.executionStatus),
    uniqueIndex('agent_action_plan_items_plan_action_idx').on(table.planId, table.actionId),
  ],
);
