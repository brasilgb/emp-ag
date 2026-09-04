import { index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * Agentes v3.4 (correio.md "Operational Supervision Observability & Run
 * History") — histórico persistente e consultável de cada TENTATIVA de
 * execução do Operational Supervisor, seja via scheduler automático (v3.1)
 * ou via `POST /operations/supervise` manual (v1.6/v2.5). Puramente
 * observacional: nenhuma linha aqui decide nada — quem decide continua
 * sendo `runOperationalSupervision`/`response-policy.ts` (v2.5), quem
 * garante exclusão mútua continua sendo o advisory lock (v3.3/v3.3.1).
 *
 * `triggerSource`: vocabulário FECHADO (`scheduler` | `manual`) — nunca
 * string livre (correio.md seção 4). Igual ao `triggeredBy` já existente
 * em `RunOperationalSupervisionOptions` (`supervisor-service.ts`) — não
 * um terceiro vocabulário paralelo, só persistido aqui.
 *
 * `status`: vocabulário FECHADO — `running` (registro criado no início de
 * uma tentativa válida, antes mesmo de saber se o lock será adquirido) |
 * `succeeded` (scan real, sem nenhuma falha isolada) |
 * `completed_with_failures` (scan real, terminou estruturalmente, mas
 * `report.failed > 0` — a distinção introduzida pela v3.2, nunca
 * confundida com sucesso puro) | `failed` (falha ESTRUTURAL — nunca uma
 * falha isolada de incidente, essa vira `completed_with_failures`) |
 * `skipped_already_running` (a tentativa nem chegou a adquirir o
 * advisory lock — `SupervisionAlreadyRunningError`, v3.3).
 *
 * Contadores (`findings`/`responses*`/`escalations*`/`failed`) espelham
 * campos já existentes em `OperationalSupervisionReport`
 * (`health-types.ts`) — nunca uma segunda lógica de cálculo (seção 9:
 * "não recalcular com lógica alternativa se a informação já existe na
 * fonte oficial"). `escalations*` são novos campos ADITIVOS do próprio
 * report (v3.4, ver `supervisor-service.ts`) — a única extensão real
 * pedida a esse arquivo nesta versão, e só de CONTAGEM, nunca de decisão.
 *
 * `errorMessage`: só `error.message` (nunca `.stack`) — mesma convenção
 * de sanitização já usada em TODO o resto do módulo `agents/operations/*`
 * desde a v2.5 (ex.: `agents.escalation.creation_failed`,
 * `agents.operations.incident.failed`, `agents.operations.scheduler.failed`)
 * — reaproveitada aqui, nenhuma sanitização nova inventada.
 *
 * Append-only na prática (seção 10): a única transição de UPDATE
 * suportada por `supervision-run-history.ts` é `running` → um dos 4
 * estados terminais, exatamente uma vez por linha — nenhum endpoint de
 * edição/CRUD genérico existe ou foi criado.
 */
export const agentOperationalSupervisionRuns = pgTable(
  'agent_operational_supervision_runs',
  {
    id: serial('id').primaryKey(),

    // scheduler | manual — nunca string livre.
    triggerSource: varchar('trigger_source', { length: 20 }).notNull(),

    // Só populado para triggerSource='manual' (o scheduler nunca tem um
    // ator humano real — mesmo racional de `triggeredBy`/`actorUserId`
    // já existentes em `RunOperationalSupervisionOptions`).
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),

    // running | succeeded | completed_with_failures | failed | skipped_already_running.
    status: varchar('status', { length: 30 }).notNull().default('running'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),

    findingsCount: integer('findings_count'),

    responsesAttempted: integer('responses_attempted'),
    responsesSucceeded: integer('responses_succeeded'),
    responsesFailed: integer('responses_failed'),

    escalationsAttempted: integer('escalations_attempted'),
    escalationsSucceeded: integer('escalations_succeeded'),
    escalationsFailed: integer('escalations_failed'),

    failedCount: integer('failed_count'),

    errorCode: varchar('error_code', { length: 100 }),
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Índices mínimos pedidos (correio.md seção 18) — casos de consulta
    // reais: listagem ordenada por `started_at DESC` (default da API),
    // filtro por `status`, filtro por `trigger_source`. Nenhum índice
    // especulativo sem caso de uso.
    index('agent_operational_supervision_runs_started_at_idx').on(table.startedAt),
    index('agent_operational_supervision_runs_status_idx').on(table.status),
    index('agent_operational_supervision_runs_trigger_source_idx').on(table.triggerSource),
  ],
);
