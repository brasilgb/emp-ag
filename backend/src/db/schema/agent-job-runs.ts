import { sql } from 'drizzle-orm';
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { agentActionPlans } from './agent-action-plans.js';
import { agentJobs } from './agent-jobs.js';

// Agentes v1.3 (correio.md seção 5) — cada Run é uma execução concreta de
// um Job, sempre nova (nunca reaproveitada — "o Run é histórico e nunca
// deve ser reutilizado").
//
// status: queued | planning | running | waiting_approval | completed |
// partial | failed | cancelled | blocked.
//
// idempotency_key: adição além da lista literal da seção 5, mesmo padrão
// de agent_executions.idempotencyKey (v1.1) — necessária para a seção 19
// (POST /agents/jobs/:id/run idempotente).
export const agentJobRuns = pgTable(
  'agent_job_runs',
  {
    id: serial('id').primaryKey(),

    jobId: integer('job_id')
      .notNull()
      .references(() => agentJobs.id, { onDelete: 'cascade' }),

    triggerType: varchar('trigger_type', { length: 20 }).notNull(),

    triggerPayload: jsonb('trigger_payload'),

    status: varchar('status', { length: 20 }).notNull().default('queued'),

    startedAt: timestamp('started_at', { withTimezone: true }),

    finishedAt: timestamp('finished_at', { withTimezone: true }),

    // 1 Run → no máximo 1 Action Plan (seção 6) — índice único parcial
    // abaixo garante isso no banco, não só em código.
    //
    // Retorno anotado como AnyPgColumn (em vez de inferido): agent-jobs
    // e agent-action-plans referenciam esta tabela de volta (job_run_id),
    // uma dependência circular real entre os três arquivos — sem a
    // anotação explícita, o TypeScript não consegue resolver os tipos
    // (erro TS7022/TS7024). Mesmo padrão recomendado pela documentação do
    // drizzle-orm para tabelas com referências circulares.
    actionPlanId: integer('action_plan_id').references(
      (): AnyPgColumn => agentActionPlans.id,
      { onDelete: 'set null' },
    ),

    errorCode: varchar('error_code', { length: 50 }),

    errorMessage: text('error_message'),

    idempotencyKey: varchar('idempotency_key', { length: 100 }),

    // Agentes v1.5 — Execution lineage (correio.md seção 4).
    // root_execution_id é sempre preenchido por agents/jobs/job-runner.ts
    // logo após o insert: uma raiz nova (trigger schedule, ou
    // internal_event cujo evento causador não tem lineage) aponta para o
    // próprio id (UPDATE dentro da mesma transação, já que o id só existe
    // depois do insert); só fica NULL na fração de segundo entre o insert
    // e esse update, nunca depois — então COALESCE(root_execution_id, id)
    // é só uma defesa, não o caminho normal de leitura. causation_run_id
    // continua NULL para sempre numa raiz nova (não tem causador). Nunca
    // duplicamos correlationId: rootExecutionId já cumpre esse papel
    // (decisão documentada no plano de implementação).
    //
    // Self-FK (AnyPgColumn, mesmo racional de actionPlanId abaixo: a
    // própria tabela referenciando a si mesma não resolve sem a anotação
    // explícita).
    rootExecutionId: integer('root_execution_id').references((): AnyPgColumn => agentJobRuns.id, {
      onDelete: 'set null',
    }),

    causationRunId: integer('causation_run_id').references((): AnyPgColumn => agentJobRuns.id, {
      onDelete: 'set null',
    }),

    // Delivery concreta (regra × evento) que disparou este Run — sem FK
    // para evitar um ciclo de import circular real com
    // agent-event-deliveries.ts (que já referencia esta tabela via
    // jobRunId); a integridade é garantida em código
    // (agents/events/event-processor.ts nunca grava um id inexistente), o
    // mesmo padrão de event_type/event_version em agent_event_rules
    // (validado em código, nunca por FK, quando o FK criaria uma
    // dependência estrutural desnecessária).
    causationEventDeliveryId: integer('causation_event_delivery_id'),

    autonomyDepth: integer('autonomy_depth').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_job_runs_job_id_idx').on(table.jobId),
    index('agent_job_runs_status_idx').on(table.status),
    index('agent_job_runs_created_at_idx').on(table.createdAt),
    uniqueIndex('agent_job_runs_action_plan_id_idx').on(table.actionPlanId),
    uniqueIndex('agent_job_runs_idempotency_idx')
      .on(table.jobId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    // Chain budget (seção 7) — contagem por rootExecutionId.
    index('agent_job_runs_root_execution_id_idx').on(table.rootExecutionId),
    // Cycle detection (seção 6) — chave root_execution_id + job_id.
    index('agent_job_runs_root_job_idx').on(table.rootExecutionId, table.jobId),
    // Rate limit por Job (seção 8) — janela por trigger_type + created_at.
    index('agent_job_runs_job_trigger_created_idx').on(table.jobId, table.triggerType, table.createdAt),
  ],
);
