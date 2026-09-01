import { index, integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

import { agentEventRules } from './agent-event-rules.js';
import { agentEvents } from './agent-events.js';
import { agentJobs } from './agent-jobs.js';

// Agentes v1.5 — Dead Letter / Blocked autonomous operations (correio.md
// seção 15). Não reaproveita agent_event_deliveries porque nem todo
// bloqueio tem uma delivery (triggers 'schedule' nunca têm evento/regra) e
// os motivos de budget/depth/rate-limit exigem `limit`/`current`, que não
// existem em nenhuma tabela hoje. Toda avaliação bloqueada pelo Autonomy
// Guard (agents/autonomy/guard.ts) grava exatamente uma linha aqui, além
// de um audit log — nunca é apagada.
//
// reason: enum fechado (correio.md seção 16), mesmo conjunto dos novos
// AgentErrorCode em agents/errors.ts.
export const agentAutonomyBlocks = pgTable(
  'agent_autonomy_blocks',
  {
    id: serial('id').primaryKey(),

    jobId: integer('job_id')
      .notNull()
      .references(() => agentJobs.id, { onDelete: 'cascade' }),

    ruleId: integer('rule_id').references(() => agentEventRules.id, { onDelete: 'set null' }),

    eventId: integer('event_id').references(() => agentEvents.id, { onDelete: 'set null' }),

    triggerType: varchar('trigger_type', { length: 20 }).notNull(),

    reason: varchar('reason', { length: 50 }).notNull(),

    // Contexto causal no momento do bloqueio (correio.md seção 4) — sem FK
    // para agent_job_runs de propósito: um bloqueio "fresh root" (ex.:
    // depth_exceeded na primeira tentativa de uma cadeia) não tem run
    // nenhum criado ainda para apontar; nulls aqui são um estado válido,
    // não um dado ausente por erro.
    rootExecutionId: integer('root_execution_id'),

    causationRunId: integer('causation_run_id'),

    attemptedDepth: integer('attempted_depth').notNull(),

    limitValue: integer('limit_value'),

    currentValue: integer('current_value'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_autonomy_blocks_job_id_idx').on(table.jobId),
    index('agent_autonomy_blocks_root_execution_id_idx').on(table.rootExecutionId),
    index('agent_autonomy_blocks_reason_idx').on(table.reason),
  ],
);
