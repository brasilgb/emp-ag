import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { clients } from './clients.js';
import { pipelineStages } from './pipeline-stages.js';
import { users } from './users.js';

// status: 'open' | 'won' | 'lost' — mantido em sincronia com o estágio do
// pipeline (is_won/is_lost) sempre que pipelineStageId muda. Denormalizado
// de propósito: permite filtrar/agrupar leads (ex.: indicadores da página
// CRM) sem precisar fazer join com pipeline_stages a cada consulta.
export const leads = pgTable(
  'leads',
  {
    id: serial('id').primaryKey(),

    name: varchar('name', {
      length: 200,
    }).notNull(),

    companyName: varchar('company_name', {
      length: 200,
    }),

    email: varchar('email', {
      length: 255,
    }),

    phone: varchar('phone', {
      length: 32,
    }),

    // String controlada nesta primeira versão (ver src/schemas/crm.ts para
    // a lista de valores aceitos). Não há tabela separada ainda.
    source: varchar('source', {
      length: 40,
    })
      .notNull()
      .default('other'),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('open'),

    pipelineStageId: integer('pipeline_stage_id')
      .notNull()
      .references(() => pipelineStages.id, {
        onDelete: 'restrict',
      }),

    ownerUserId: integer('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Numeric, nunca float, para representar valores monetários com
    // precisão exata.
    estimatedValue: numeric('estimated_value', {
      precision: 14,
      scale: 2,
    }),

    probability: integer('probability').notNull().default(0),

    nextActionAt: timestamp('next_action_at', {
      withTimezone: true,
    }),

    nextActionDescription: varchar('next_action_description', {
      length: 255,
    }),

    notes: text('notes'),

    // Preenchido apenas pela rota de conversão (POST /crm/leads/:id/convert),
    // nunca por um PATCH genérico.
    convertedClientId: integer('converted_client_id').references(
      () => clients.id,
      { onDelete: 'set null' },
    ),

    createdBy: integer('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('leads_pipeline_stage_id_idx').on(table.pipelineStageId),
    index('leads_owner_user_id_idx').on(table.ownerUserId),
    index('leads_status_idx').on(table.status),
    index('leads_source_idx').on(table.source),
    index('leads_next_action_at_idx').on(table.nextActionAt),
    check(
      'leads_probability_range',
      sql`${table.probability} >= 0 AND ${table.probability} <= 100`,
    ),
  ],
);
