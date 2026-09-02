import { index, integer, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { agentJobs } from './agent-jobs.js';
import { users } from './users.js';

// Agentes v1.7 (correio.md "ETAPA 2 — Modelo de configuração") —
// configuração operacional persistida, com escopo, tipo e validação
// explícitos (nunca uma tabela solta de key/value sem semântica — essa
// já existe, `settings`, usada só pelo global autonomy switch, que não
// tem tipo/faixa/escopo por natureza: um switch booleano único não
// precisa dessas colunas. Este é um modelo novo e mais rico, não uma
// duplicata).
//
// scope: 'global' | 'job'. scope_id é sempre NULL para 'global' e sempre
// o id de um agent_jobs para 'job' — cada linha é um OVERRIDE persistido
// (a ausência de linha significa "sem override", nunca um valor
// implícito de 0/false; ver agents/settings/resolver.ts).
//
// Unique constraint (key, scope, scope_id) da seção 2: como Postgres
// trata NULL como distinto em índices únicos comuns (múltiplas linhas
// globais para a mesma key não colidiriam), usamos dois índices únicos
// parciais em vez de um único constraint — "implementar de forma segura
// equivalente" quando o unique direto não cobre corretamente o caso NULL
// (correio.md).
export const agentOperationalSettings = pgTable(
  'agent_operational_settings',
  {
    id: serial('id').primaryKey(),

    key: varchar('key', { length: 100 }).notNull(),

    scope: varchar('scope', { length: 20 }).notNull(),

    scopeId: integer('scope_id').references(() => agentJobs.id, { onDelete: 'cascade' }),

    // JSONB para acomodar number/boolean sem precisar de colunas
    // separadas por tipo — validado contra o catálogo (agents/settings/
    // catalog.ts) antes de qualquer INSERT/UPDATE, nunca confiado cru.
    value: jsonb('value').notNull(),

    valueType: varchar('value_type', { length: 20 }).notNull(),

    updatedBy: integer('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_operational_settings_global_idx')
      .on(table.key)
      .where(sql`${table.scope} = 'global'`),
    uniqueIndex('agent_operational_settings_job_idx')
      .on(table.key, table.scopeId)
      .where(sql`${table.scope} = 'job'`),
    index('agent_operational_settings_scope_idx').on(table.scope, table.scopeId),
  ],
);
