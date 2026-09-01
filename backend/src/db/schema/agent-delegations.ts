import { index, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

import { agentJobRuns } from './agent-job-runs.js';
import { agents } from './agents.js';

// Agentes v1.3 (correio.md seção 11) — registro estrutural de delegação:
// "Director → Specialist". NÃO é transferência de autoridade — o agente
// alvo continua sujeito às suas próprias permissions/tools/risk/policy/
// approval/budget (agents/jobs/job-runner.ts nunca deriva permissão do
// agente pai para o agente alvo, sempre reavalia via
// agents/policy/action-policy-evaluator.ts com as permissions do usuário
// que solicitou o Job). Só uma camada é suportada nesta versão —
// `parentAgentId` é sempre o agente dono do Job, nunca o targetAgentId de
// outra delegação (profundidade 1 garantida por construção, seção 12).
export const agentDelegations = pgTable(
  'agent_delegations',
  {
    id: serial('id').primaryKey(),

    parentAgentId: integer('parent_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),

    targetAgentId: integer('target_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),

    jobRunId: integer('job_run_id').references(() => agentJobRuns.id, { onDelete: 'cascade' }),

    objective: text('objective').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_delegations_job_run_id_idx').on(table.jobRunId),
    index('agent_delegations_target_agent_id_idx').on(table.targetAgentId),
  ],
);
