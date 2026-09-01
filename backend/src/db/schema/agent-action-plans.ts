import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { agentJobRuns } from './agent-job-runs.js';
import { users } from './users.js';

// Agentes v1.2 (correio.md seções 5/6) — plano estruturado de ações
// gerado pelo Diretor Virtual a partir de uma intenção em texto livre.
//
// status: draft | evaluating | waiting_approval | executing | completed |
// partial | failed | cancelled — agregado a partir do execution_status dos
// itens (agent_action_plan_items) pelo executor
// (agents/executor/action-plan-executor.ts), nunca escrito diretamente
// pela rota.
//
// job_run_id (v1.3, correio.md seção 6): nullable — plano criado
// diretamente via POST /agents/action-plans (v1.2) continua sem Job,
// comportamento inalterado. Preenchido só quando o plano nasce de
// agents/jobs/job-runner.ts.
export const agentActionPlans = pgTable(
  'agent_action_plans',
  {
    id: serial('id').primaryKey(),

    requestedBy: integer('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    jobRunId: integer('job_run_id').references(() => agentJobRuns.id, { onDelete: 'set null' }),

    objective: text('objective').notNull(),

    summary: text('summary').notNull(),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('draft'),

    llmProvider: varchar('llm_provider', {
      length: 30,
    }),

    llmModel: varchar('llm_model', {
      length: 100,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    completedAt: timestamp('completed_at', {
      withTimezone: true,
    }),
  },
  (table) => [
    index('agent_action_plans_status_idx').on(table.status),
    index('agent_action_plans_requested_by_idx').on(table.requestedBy),
    index('agent_action_plans_created_at_idx').on(table.createdAt),
    index('agent_action_plans_job_run_id_idx').on(table.jobRunId),
  ],
);
