import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { users } from './users.js';

/**
 * Agentes v2.6 (correio.md "4. Conceito: Agent Responsibility") —
 * responsabilidade operacional atribuída a um agente: o que observar +
 * para quem escalar, NUNCA permissão de executar (seção 2: "Responsibility
 * NÃO significa permission" — nenhuma coluna aqui concede autonomia,
 * permission ou role; toda ação real continua passando pelo pipeline
 * oficial existente).
 *
 * `domain`: reaproveita o MESMO vocabulário de `SignalDomain`
 * (director/types.ts — 'crm'|'projects'|'finance'|'support'|'agents'),
 * nunca um novo enum de domínio.
 *
 * `priority`: reaproveita o MESMO vocabulário já usado por Goals/
 * Initiatives/Decisions ('low'|'medium'|'high'|'critical'), nunca um
 * quarto conjunto de valores no projeto.
 *
 * responsibilityType: monitor | review | coordinate | follow_up (seção
 * 5) — 4 tipos, sem DSL.
 *
 * escalationPolicy: none | agent | human | agent_then_human (seção 8).
 * CHECK constraint (seção 28: "integridade referencial... utilizar FKs
 * quando compatíveis") garante no BANCO que o(s) alvo(s) certo(s) estão
 * preenchidos para a política escolhida — nunca só uma validação Zod
 * facilmente contornável por um INSERT direto/futuro bug de código.
 */
export const agentResponsibilities = pgTable(
  'agent_responsibilities',
  {
    id: serial('id').primaryKey(),

    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),

    name: varchar('name', { length: 150 }).notNull(),
    description: text('description'),

    domain: varchar('domain', { length: 20 }).notNull(),
    responsibilityType: varchar('responsibility_type', { length: 20 }).notNull(),

    enabled: boolean('enabled').notNull().default(true),
    priority: varchar('priority', { length: 20 }).notNull().default('medium'),

    // Condições descritivas/filtros mínimos (seção 5) — NUNCA
    // interpretadas como código/DSL executável (seção 32: "não
    // implementar uma DSL complexa"); só um filtro adicional opcional
    // que o serviço de ownership resolution pode ler, nunca `eval`ado.
    conditions: jsonb('conditions').notNull().default({}),

    escalationPolicy: varchar('escalation_policy', { length: 20 }).notNull().default('none'),
    escalationTargetAgentId: integer('escalation_target_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    escalationTargetUserId: integer('escalation_target_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('agent_responsibilities_agent_idx').on(table.agentId),
    index('agent_responsibilities_domain_idx').on(table.domain),
    index('agent_responsibilities_enabled_idx').on(table.enabled),
    check(
      'agent_responsibilities_escalation_target_matches_policy',
      sql`(
        (${table.escalationPolicy} = 'none') OR
        (${table.escalationPolicy} = 'agent' AND ${table.escalationTargetAgentId} IS NOT NULL) OR
        (${table.escalationPolicy} = 'human' AND ${table.escalationTargetUserId} IS NOT NULL) OR
        (${table.escalationPolicy} = 'agent_then_human' AND ${table.escalationTargetAgentId} IS NOT NULL AND ${table.escalationTargetUserId} IS NOT NULL)
      )`,
    ),
  ],
);
