import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

// Agentes v1.4 (correio.md seção 4) — histórico de eventos internos de
// negócio, publicados via agents/events/publisher.ts. Nunca apagado
// (mesmo evento já `processed` continua na tabela como histórico
// auditável).
//
// status: pending | processing | processed | failed | ignored.
//
// next_attempt_at: adição além da lista literal da seção 4, necessária
// para o backoff de retry da seção 14 (mesmo racional de idempotencyKey
// em outras tabelas do módulo — campo extra sustentando um requisito
// funcional explícito, não dado de negócio novo).
export const agentEvents = pgTable(
  'agent_events',
  {
    id: serial('id').primaryKey(),

    eventType: varchar('event_type', { length: 100 }).notNull(),

    eventVersion: integer('event_version').notNull(),

    source: varchar('source', { length: 100 }),

    aggregateType: varchar('aggregate_type', { length: 50 }),

    aggregateId: varchar('aggregate_id', { length: 50 }),

    payload: jsonb('payload').notNull(),

    idempotencyKey: varchar('idempotency_key', { length: 150 }),

    status: varchar('status', { length: 20 }).notNull().default('pending'),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),

    processedAt: timestamp('processed_at', { withTimezone: true }),

    attemptCount: integer('attempt_count').notNull().default(0),

    lastError: text('last_error'),

    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),

    // Agentes v1.5 — Lineage propagation (correio.md seções 13/14).
    // Preenchidos automaticamente por agents/events/publisher.ts a partir
    // do contexto de execução (agents/autonomy/lineage-context.ts,
    // AsyncLocalStorage) quando o evento nasce de uma ação executada
    // dentro de um Run — nunca setados manualmente por rota/domínio, para
    // nunca dar lineage falsa a um evento criado diretamente por usuário
    // (seção 14). Sem FK para agent_job_runs de propósito: evitaria um
    // ciclo de import (agent-job-runs.ts não depende deste arquivo hoje)
    // só para um dado que já é só metadata de auditoria, nunca usado em
    // join de integridade referencial.
    causedByRunId: integer('caused_by_run_id'),
    rootExecutionId: integer('root_execution_id'),
    autonomyDepth: integer('autonomy_depth'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_events_status_idx').on(table.status),
    index('agent_events_event_type_idx').on(table.eventType),
    index('agent_events_received_at_idx').on(table.receivedAt),
    index('agent_events_aggregate_idx').on(table.aggregateType, table.aggregateId),
    uniqueIndex('agent_events_idempotency_idx')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index('agent_events_caused_by_run_id_idx').on(table.causedByRunId),
  ],
);
