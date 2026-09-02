import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { agentActionPlans } from './agent-action-plans.js';
import { users } from './users.js';

/**
 * Agentes v1.9 (correio.md "4. Decision Item") - representacao
 * persistente de uma situacao que merece acompanhamento executivo,
 * construida sobre os Operational Signals da v1.8 (nunca duplica a
 * coleta de dados dos modulos - so o resultado ja classificado).
 *
 * Nome escolhido (`agent_director_decisions`) seguindo o padrao ja
 * estabelecido de tabelas do modulo de agentes prefixadas `agent_*`
 * (agent_autonomy_blocks, agent_operational_settings...).
 *
 * `deduplicationKey` (correio.md secao 6): coluna unica NOT NULL, nunca
 * um constraint composto com colunas nullable (entity_type/entity_id
 * podem ser null para sinais futuros sem entidade - Postgres trata NULL
 * como distinto em unique constraints comuns, o mesmo problema resolvido
 * na v1.7 com indices parciais; aqui a solucao mais simples e robusta e
 * normalizar tudo em UMA string sempre presente:
 * `${signalType}::${entityType ?? 'none'}::${entityId ?? signalId}`).
 * Upsert via ON CONFLICT nesta coluna e o mecanismo real de
 * deduplicacao sob concorrencia (correio.md secao 30) - nunca
 * find-then-insert.
 *
 * `approvalId` deliberadamente NAO existe como coluna: um approval real
 * ja e relacionavel via action_plan_id -> agent_action_plan_items ->
 * agent_approvals (mesma cadeia real do dominio, sem copia). Decisao
 * documentada no relatorio de entrega (correio.md secao 4: "preferir
 * relacao adequada em vez de copia inconsistente").
 *
 * `priority_score`/`priority_factors` sao persistidos (nao derivados a
 * cada leitura) - decisao documentada: aging/recorrencia so mudam
 * quando o proprio scan roda de novo, entao recalcular a cada GET seria
 * trabalho redundante sem ganho de precisao real (correio.md secao 11:
 * "escolher conscientemente entre persistir e derivar").
 */
export const agentDirectorDecisions = pgTable(
  'agent_director_decisions',
  {
    id: serial('id').primaryKey(),

    deduplicationKey: varchar('deduplication_key', { length: 300 }).notNull(),

    signalType: varchar('signal_type', { length: 100 }).notNull(),
    domain: varchar('domain', { length: 20 }).notNull(),

    entityType: varchar('entity_type', { length: 50 }),
    entityId: integer('entity_id'),

    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').notNull(),

    severity: varchar('severity', { length: 20 }).notNull(),
    impact: varchar('impact', { length: 20 }).notNull(),
    urgency: varchar('urgency', { length: 20 }).notNull(),

    priorityScore: integer('priority_score').notNull(),
    priorityFactors: jsonb('priority_factors').notNull(),

    // status: open | acknowledged | action_planned | awaiting_approval | resolved | dismissed
    status: varchar('status', { length: 20 }).notNull().default('open'),

    requiresHumanAttention: boolean('requires_human_attention').notNull().default(false),

    firstDetectedAt: timestamp('first_detected_at', { withTimezone: true }).notNull(),
    lastDetectedAt: timestamp('last_detected_at', { withTimezone: true }).notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),

    actionPlanId: integer('action_plan_id').references(() => agentActionPlans.id, { onDelete: 'set null' }),

    assignedUserId: integer('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),

    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: integer('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: integer('dismissed_by').references(() => users.id, { onDelete: 'set null' }),
    dismissReason: text('dismiss_reason'),

    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_director_decisions_dedup_idx').on(table.deduplicationKey),
    index('agent_director_decisions_status_idx').on(table.status),
    index('agent_director_decisions_domain_idx').on(table.domain),
    index('agent_director_decisions_priority_idx').on(table.priorityScore),
    index('agent_director_decisions_assigned_user_idx').on(table.assignedUserId),
    index('agent_director_decisions_last_detected_idx').on(table.lastDetectedAt),
    index('agent_director_decisions_requires_attention_idx').on(table.requiresHumanAttention),
  ],
);
