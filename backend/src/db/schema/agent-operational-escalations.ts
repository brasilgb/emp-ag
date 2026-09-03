import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { agentResponsibilities } from './agent-responsibilities.js';
import { agents } from './agents.js';
import { users } from './users.js';

/**
 * Agentes v2.6 (correio.md "9. Escalonamento entre agentes") — registro
 * FORMAL de escalonamento — NUNCA execução (seção 12: "Escalation nunca
 * executa ação diretamente" — nenhuma coluna aqui referencia Action
 * Plan/tool/execução; é uma entidade puramente operacional/gerencial).
 *
 * Avaliação feita ANTES de criar esta tabela (seção 3: "não crie
 * mecanismos paralelos se já houver conceitos reutilizáveis"): a
 * Director Decision Queue (`agent_director_decisions`, v1.9) já cobre
 * "atenção humana genérica" e já é reaproveitada pelo Recovery v2.4/
 * Operational Supervisor v2.5 para `manual_attention` — mantida
 * INALTERADA (correio.md v2.6 topo: "não refatore módulos anteriores
 * sem necessidade objetiva"). Esta tabela NOVA é semanticamente distinta
 * o bastante para justificar existir separada: (a) Decision Queue não
 * tem conceito de "target AGENT" (só usuário via `assignedUserId`) — v2.6
 * precisa rotear para outro AGENTE, não só humano; (b) Decision Queue é
 * por SINAL operacional bruto (crm/projects/finance/support/agents),
 * nunca por RESPONSIBILITY (quem é o dono operacional configurado de um
 * domínio) — v2.6 introduz essa camada de ownership que não existia.
 *
 * `dedupKey` (seção 15, "critério bloqueante"): fingerprint
 * determinístico único — `${responsibilityId}:${problemType}:${entityType}:${entityId}`
 * (`escalations/service.ts`). Índice único SIMPLES (não parcial): a
 * mesma condição NUNCA gera uma segunda linha — reabre a MESMA linha
 * quando `resolved`/`dismissed` e a condição reocorre (mesmo padrão já
 * usado por `goals/review-service.ts` na v2.0, "saneamento seção 5" —
 * decisão documentada em `escalations/service.ts`).
 *
 * FK de `responsibilityId` com `onDelete: 'restrict'` (nunca cascade) —
 * garante NO BANCO que uma Responsibility com histórico de escalation
 * NUNCA pode ser excluída (seção 31: "preferência arquitetural:
 * disabled" para entidades com histórico) — só desabilitada.
 */
export const agentOperationalEscalations = pgTable(
  'agent_operational_escalations',
  {
    id: serial('id').primaryKey(),

    responsibilityId: integer('responsibility_id')
      .notNull()
      .references(() => agentResponsibilities.id, { onDelete: 'restrict' }),

    // Cópia do `agentId` da Responsibility NO MOMENTO da criação (seção
    // 30: "escalations antigas mantêm destino histórico original" —
    // nunca segue mudanças posteriores de dono da Responsibility).
    sourceAgentId: integer('source_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),

    targetAgentId: integer('target_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    targetUserId: integer('target_user_id').references(() => users.id, { onDelete: 'set null' }),

    reason: text('reason').notNull(),
    severity: varchar('severity', { length: 20 }).notNull(),

    // status: open | acknowledged | resolved | dismissed.
    status: varchar('status', { length: 20 }).notNull().default('open'),

    entityType: varchar('entity_type', { length: 50 }),
    entityId: integer('entity_id'),

    dedupKey: varchar('dedup_key', { length: 300 }).notNull(),

    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: integer('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: integer('resolved_by').references(() => users.id, { onDelete: 'set null' }),

    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedBy: integer('dismissed_by').references(() => users.id, { onDelete: 'set null' }),
    dismissReason: text('dismiss_reason'),
  },
  (table) => [
    uniqueIndex('agent_operational_escalations_dedup_idx').on(table.dedupKey),
    index('agent_operational_escalations_responsibility_idx').on(table.responsibilityId),
    index('agent_operational_escalations_status_idx').on(table.status),
    index('agent_operational_escalations_severity_idx').on(table.severity),
    index('agent_operational_escalations_target_agent_idx').on(table.targetAgentId),
    index('agent_operational_escalations_target_user_idx').on(table.targetUserId),
  ],
);
