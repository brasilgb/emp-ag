import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { agentOperationalEscalations } from './agent-operational-escalations.js';
import { agentResponsibilities } from './agent-responsibilities.js';
import { agents } from './agents.js';
import { users } from './users.js';

/**
 * Agentes v2.7 (correio.md seção 3) — acompanhamento operacional
 * estruturado: "este assunto precisa ser acompanhado até que exista uma
 * conclusão operacional." NUNCA uma autorização para executar (seção 1,
 * itens 1-5) — nenhuma coluna aqui referencia tool/Action Plan/execução;
 * é puramente um registro gerencial de acompanhamento, no mesmo espírito
 * de `agent_operational_escalations` (v2.6).
 *
 * Revisão feita antes de criar esta tabela (correio.md seção 2): nem
 * `agent_director_decisions` (genérico, sem conceito de responsibility/
 * escalation/prazo) nem `agent_operational_escalations` (termina no
 * reconhecimento/resolução da notificação, sem estado de acompanhamento
 * prolongado — sem `waiting`, sem `dueAt`/`nextReviewAt`) cobrem o que a
 * v2.7 pede — daí a tabela nova, reaproveitando ambas por FK em vez de
 * duplicar dados.
 *
 * `ownerAgentId`: cópia do dono real (`agentResponsibilities.agentId`) no
 * MOMENTO da criação — segue o mesmo princípio já estabelecido em
 * `agent_operational_escalations.sourceAgentId` (v2.6, seção 30):
 * mudanças posteriores de ownership da Responsibility NUNCA reescrevem o
 * histórico de um FollowUp já criado (correio.md v2.7 seção 9).
 *
 * `sourceType`/`sourceId`: origem determinística do FollowUp —
 * `'escalation'` (automático, via `escalations/supervisor-integration.ts`)
 * ou `'responsibility'` (criação gerencial direta, seção 6.B). `escalationId`
 * é a FK forte para o caso `'escalation'` (nula quando a origem é
 * `'responsibility'`).
 *
 * `dedupKey`: para origem `'escalation'`, `escalation:${escalationId}` —
 * uma escalation já é o evento deduplicado (v2.6); um FollowUp por
 * escalation é suficiente, reaberto quando a escalation reabre (seção 7/8).
 * Para origem `'responsibility'` (criação manual, sempre um ato humano
 * deliberado, nunca uma detecção automática repetida), um UUID por
 * criação — não há semântica de "mesma ocorrência" a deduplicar aqui,
 * mas a coluna continua `NOT NULL UNIQUE` para manter uma única
 * disciplina de dedup em toda a tabela (`service.ts` documenta a decisão).
 *
 * FKs: `responsibilityId`/`ownerAgentId`/`createdBy` em `restrict` (nunca
 * cascade — preserva histórico, seção 8 dos "critérios bloqueantes");
 * `escalationId`/`assignedUserId`/`completedBy`/`dismissedBy` em
 * `set null` (referência opcional; perder o usuário não deveria impedir
 * a entidade de existir).
 */
export const agentOperationalFollowUps = pgTable(
  'agent_operational_follow_ups',
  {
    id: serial('id').primaryKey(),

    responsibilityId: integer('responsibility_id')
      .notNull()
      .references(() => agentResponsibilities.id, { onDelete: 'restrict' }),

    escalationId: integer('escalation_id').references(() => agentOperationalEscalations.id, { onDelete: 'set null' }),

    // 'escalation' | 'responsibility' — vocabulário fechado, validado na
    // camada de serviço (types.ts).
    sourceType: varchar('source_type', { length: 20 }).notNull(),
    sourceId: integer('source_id'),

    ownerAgentId: integer('owner_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    assignedUserId: integer('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),

    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),

    // status: open | in_progress | waiting | completed | dismissed.
    status: varchar('status', { length: 20 }).notNull().default('open'),
    priority: varchar('priority', { length: 20 }).notNull().default('medium'),

    dueAt: timestamp('due_at', { withTimezone: true }),
    nextReviewAt: timestamp('next_review_at', { withTimezone: true }),

    // Seção 12 — só descritivo, nunca interpretado como comando.
    waitingReason: text('waiting_reason'),
    waitingUntil: timestamp('waiting_until', { withTimezone: true }),

    dedupKey: varchar('dedup_key', { length: 300 }).notNull(),
    metadata: jsonb('metadata').notNull().default({}),

    createdBy: integer('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    // Mapeado para a transição real `open → in_progress` ("iniciar" —
    // seção 3 pede `acknowledgedAt` mas a máquina de estados real da
    // seção 4 não tem um estado "acknowledged" separado; decisão
    // documentada em `service.ts:startFollowUp`).
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: integer('completed_by').references(() => users.id, { onDelete: 'set null' }),
    resolution: text('resolution'),

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: integer('dismissed_by').references(() => users.id, { onDelete: 'set null' }),
    dismissReason: text('dismiss_reason'),
  },
  (table) => [
    uniqueIndex('agent_operational_follow_ups_dedup_idx').on(table.dedupKey),
    index('agent_operational_follow_ups_status_idx').on(table.status),
    index('agent_operational_follow_ups_owner_idx').on(table.ownerAgentId),
    index('agent_operational_follow_ups_assigned_user_idx').on(table.assignedUserId),
    index('agent_operational_follow_ups_responsibility_idx').on(table.responsibilityId),
    index('agent_operational_follow_ups_escalation_idx').on(table.escalationId),
    index('agent_operational_follow_ups_due_at_idx').on(table.dueAt),
  ],
);
