import {
  boolean,
  index,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// department: director | sales | projects | finance | support |
// customer_success (v1). Preparado para futuramente aceitar marketing,
// development, qa, devops, legal, bi — sem implementá-los ainda.
// status: active | paused | disabled.
// defaultAutonomyLevel: read | prepare | execute | approval_required.
export const agents = pgTable(
  'agents',
  {
    id: serial('id').primaryKey(),

    name: varchar('name', {
      length: 150,
    }).notNull(),

    slug: varchar('slug', {
      length: 100,
    })
      .notNull()
      .unique(),

    department: varchar('department', {
      length: 30,
    }).notNull(),

    description: text('description'),

    // Guardado para configuração futura de LLM (seção 55) — nesta v1 não é
    // enviado a nenhum modelo.
    systemPrompt: text('system_prompt'),

    status: varchar('status', {
      length: 20,
    })
      .notNull()
      .default('active'),

    // true apenas para o Diretor Virtual (slug = director).
    isSystem: boolean('is_system')
      .notNull()
      .default(false),

    isActive: boolean('is_active')
      .notNull()
      .default(true),

    defaultAutonomyLevel: varchar('default_autonomy_level', {
      length: 20,
    })
      .notNull()
      .default('read'),

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
    index('agents_department_idx').on(table.department),
    index('agents_status_idx').on(table.status),
  ],
);
