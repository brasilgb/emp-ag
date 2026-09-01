import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { users } from './users.js';

// Agentes v1.3 (correio.md seção 3) — um Job representa um objetivo
// operacional persistente ("acompanhar leads quentes sem contato",
// "gerar resumo financeiro diário"), reexecutado ao longo do tempo. O
// texto de `objective` é enviado ao Action Planner (mesmo agents/planner/
// da v1.2) a cada Run — o Job nunca gera SQL/código, só decide QUANDO
// pedir um novo Action Plan.
//
// status: draft | active | paused | completed | failed | cancelled.
// Transições só acontecem via endpoints dedicados
// (routes/agents/jobs.ts: pause/resume/cancel) — nunca por PATCH genérico
// (seção 15: "evitar endpoint genérico que permita alteração arbitrária
// de status").
//
// trigger_type: manual | schedule | internal_event (seção 4).
// schedule_config/event_config: shape validado por Zod
// (agents/jobs/schemas.ts) — nunca cron arbitrário, nunca webhook
// arbitrário.
export const agentJobs = pgTable(
  'agent_jobs',
  {
    id: serial('id').primaryKey(),

    name: varchar('name', { length: 150 }).notNull(),

    description: text('description'),

    objective: text('objective').notNull(),

    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),

    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    status: varchar('status', { length: 20 }).notNull().default('draft'),

    triggerType: varchar('trigger_type', { length: 20 }).notNull(),

    scheduleConfig: jsonb('schedule_config'),

    eventConfig: jsonb('event_config'),

    // Execution Budget (seção 8) — defaults seguros, sempre exigidos
    // (nunca nullable): nenhum Job existe sem limite.
    maxRunsPerDay: integer('max_runs_per_day').notNull().default(24),

    maxActionsPerRun: integer('max_actions_per_run').notNull().default(10),

    maxOpenApprovals: integer('max_open_approvals').notNull().default(10),

    timeoutSeconds: integer('timeout_seconds').notNull().default(60),

    shadowMode: boolean('shadow_mode').notNull().default(false),

    allowConcurrentRuns: boolean('allow_concurrent_runs').notNull().default(false),

    lastRunAt: timestamp('last_run_at', { withTimezone: true }),

    nextRunAt: timestamp('next_run_at', { withTimezone: true }),

    // Agentes v1.5 — Granular Autonomy Switch (correio.md seção 10). NÃO
    // substitui o kill switch global (agents/jobs/global-switch.ts,
    // tabela `settings`) — este é só o nível "por Job", avaliado depois do
    // global (ordem documentada em agents/autonomy/guard.ts). Só afeta
    // triggers automáticos, mesmo racional do switch global.
    autonomyEnabled: boolean('autonomy_enabled').notNull().default(true),

    // Circuit Breaker por Job (correio.md seção 9) — estado persistido
    // (nunca em memória: precisa sobreviver a restart e ser lido/escrito
    // sob o mesmo lock de linha que já protege budget/concorrência em
    // agents/jobs/job-runner.ts). half_open é representado explicitamente
    // (não derivado) para nunca permitir duas tentativas de trial
    // concorrentes (guard trata half_open como bloqueado para um segundo
    // trigger enquanto o primeiro trial não terminou).
    circuitState: varchar('circuit_state', { length: 20 }).notNull().default('closed'),

    circuitFailureCount: integer('circuit_failure_count').notNull().default(0),

    circuitOpenedAt: timestamp('circuit_opened_at', { withTimezone: true }),

    // Override por Job do rate limit autônomo global (correio.md seção 8)
    // — precedência: job override → global (env.AGENT_JOB_AUTONOMY_RATE_LIMIT)
    // → default. Ambos nullable: ausentes, o Job usa o valor global.
    autonomyRateLimitOverride: integer('autonomy_rate_limit_override'),

    autonomyRateWindowOverrideSeconds: integer('autonomy_rate_window_override_seconds'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_jobs_status_idx').on(table.status),
    index('agent_jobs_trigger_type_idx').on(table.triggerType),
    index('agent_jobs_next_run_at_idx').on(table.nextRunAt),
    index('agent_jobs_agent_id_idx').on(table.agentId),
    index('agent_jobs_created_by_idx').on(table.createdBy),
  ],
);
