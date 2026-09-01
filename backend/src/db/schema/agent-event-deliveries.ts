import { index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { agentEventRules } from './agent-event-rules.js';
import { agentEvents } from './agent-events.js';
import { agentJobRuns } from './agent-job-runs.js';
import { agentJobs } from './agent-jobs.js';

// Agentes v1.4 (correio.md seção 11) — rastreabilidade Run → Rule →
// Event: "por que este Agent Job Run foi criado?". Índice único em
// (event_id, rule_id) é a proteção de idempotência central da seção 12 —
// o processor insere com `ON CONFLICT (event_id, rule_id) DO NOTHING`,
// então o mesmo par nunca produz uma segunda linha nem um segundo Run.
//
// status: matched | triggered | ignored | failed.
export const agentEventDeliveries = pgTable(
  'agent_event_deliveries',
  {
    id: serial('id').primaryKey(),

    eventId: integer('event_id')
      .notNull()
      .references(() => agentEvents.id, { onDelete: 'cascade' }),

    ruleId: integer('rule_id')
      .notNull()
      .references(() => agentEventRules.id, { onDelete: 'cascade' }),

    jobId: integer('job_id')
      .notNull()
      .references(() => agentJobs.id, { onDelete: 'cascade' }),

    jobRunId: integer('job_run_id').references(() => agentJobRuns.id, { onDelete: 'set null' }),

    status: varchar('status', { length: 20 }).notNull().default('matched'),

    errorCode: varchar('error_code', { length: 50 }),

    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agent_event_deliveries_event_rule_idx').on(table.eventId, table.ruleId),
    index('agent_event_deliveries_job_run_id_idx').on(table.jobRunId),
    index('agent_event_deliveries_status_idx').on(table.status),
  ],
);
