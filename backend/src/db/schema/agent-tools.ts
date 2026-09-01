import {
  boolean,
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// handler: string que mapeia para um handler registrado em código
// (backend/src/agents/tool-registry.ts), nunca código arbitrário. Ex.:
// "finance.get_summary". Handler inexistente no registry → rejeitar
// (seção 9).
//
// input_schema/output_schema são apenas descritivos (documentação exibida
// em GET /agents/tools) — a validação real de entrada usa sempre o schema
// Zod definido junto ao handler no registry, nunca este JSONB (seção 51).
//
// autonomy_level: read | prepare | execute | approval_required.
export const agentTools = pgTable(
  'agent_tools',
  {
    id: serial('id').primaryKey(),

    name: varchar('name', {
      length: 150,
    }).notNull(),

    slug: varchar('slug', {
      length: 150,
    })
      .notNull()
      .unique(),

    description: text('description'),

    department: varchar('department', {
      length: 30,
    }).notNull(),

    autonomyLevel: varchar('autonomy_level', {
      length: 20,
    }).notNull(),

    handler: varchar('handler', {
      length: 150,
    })
      .notNull()
      .unique(),

    inputSchema: jsonb('input_schema'),

    outputSchema: jsonb('output_schema'),

    isActive: boolean('is_active')
      .notNull()
      .default(true),

    isSensitive: boolean('is_sensitive')
      .notNull()
      .default(false),

    // Agentes v1.2 (correio.md, seção 4) — classificação de risco usada
    // pelo Action Policy Evaluator (agents/policy/action-policy-evaluator.ts)
    // para decidir execute/approval_required/blocked/shadow por ação de um
    // Action Plan. Independente de `autonomy_level`/`is_sensitive`, que
    // continuam sendo a única fonte de verdade para o pipeline de execução
    // única da v1.1 (agents/execution/pipeline.ts) — nada aqui muda o
    // comportamento de POST /agents/execute.
    risk: varchar('risk', {
      length: 10,
    })
      .notNull()
      .default('medium'),

    mutatesData: boolean('mutates_data')
      .notNull()
      .default(true),

    requiresApproval: boolean('requires_approval')
      .notNull()
      .default(false),

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
    index('agent_tools_department_idx').on(table.department),
    index('agent_tools_autonomy_level_idx').on(table.autonomyLevel),
    index('agent_tools_is_active_idx').on(table.isActive),
    index('agent_tools_risk_idx').on(table.risk),
  ],
);
