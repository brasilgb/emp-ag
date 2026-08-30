import {
  boolean,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { agents } from './agents.js';
import { agentTools } from './agent-tools.js';

// Relação agente ↔ ferramenta. Uma execução só é permitida se
// can_use = true aqui E o usuário possuir a permission exigida pela tool
// (dupla autorização, seção 28) — não basta um dos dois.
export const agentToolPermissions = pgTable(
  'agent_tool_permissions',
  {
    id: serial('id').primaryKey(),

    agentId: integer('agent_id')
      .notNull()
      .references(() => agents.id, {
        onDelete: 'cascade',
      }),

    toolId: integer('tool_id')
      .notNull()
      .references(() => agentTools.id, {
        onDelete: 'cascade',
      }),

    canUse: boolean('can_use')
      .notNull()
      .default(true),

    // Força approval_required para este par agente/tool mesmo que a tool
    // em si não seja approval_required nem sensível (seção 13).
    requiresApprovalOverride: boolean('requires_approval_override')
      .notNull()
      .default(false),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('agent_tool_permissions_agent_tool_idx').on(
      table.agentId,
      table.toolId,
    ),
  ],
);
