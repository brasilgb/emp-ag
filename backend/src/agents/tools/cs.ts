import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../db/index.js';
import { clients, customerSuccessAccounts } from '../../db/schema/index.js';
import {
  getAtRiskAccounts,
  getDueFollowups,
} from '../../routes/customer-success/accounts.js';
import { createFollowupActivity } from '../../routes/customer-success/activities.js';
import { getExpansionOpportunities } from '../../routes/customer-success/opportunities.js';
import { audit } from '../../services/audit.js';
import { registerTool } from '../tool-registry.js';
import type { ToolDefinition } from '../types.js';
import { AgentError } from '../errors.js';

const emptyInput = z.object({}).strict();

// cs.get_at_risk_accounts (READ)
export const csGetAtRiskAccounts: ToolDefinition<Record<string, never>> = {
  handler: 'cs.get_at_risk_accounts',
  requiredPermission: 'cs.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getAtRiskAccounts();

    return {
      success: true,
      summary: `${rows.length} conta(s) em risco.`,
      data: rows,
    };
  },
};

// cs.get_due_followups (READ)
export const csGetDueFollowups: ToolDefinition<Record<string, never>> = {
  handler: 'cs.get_due_followups',
  requiredPermission: 'cs.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getDueFollowups();

    return {
      success: true,
      summary: `${rows.length} follow-up(s) pendente(s).`,
      data: rows,
    };
  },
};

// cs.get_expansion_opportunities (READ)
export const csGetExpansionOpportunities: ToolDefinition<Record<string, never>> = {
  handler: 'cs.get_expansion_opportunities',
  requiredPermission: 'cs.opportunities.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getExpansionOpportunities();

    return {
      success: true,
      summary: `${rows.length} oportunidade(s) de expansão em aberto.`,
      data: rows,
    };
  },
};

// cs.prepare_customer_followup (PREPARE) — só gera o rascunho; nunca
// envia (seção 24/26).
const prepareFollowupInput = z.object({
  accountId: z.coerce.number().int().positive('accountId inválido.'),
});

export const csPrepareCustomerFollowup: ToolDefinition<
  z.infer<typeof prepareFollowupInput>
> = {
  handler: 'cs.prepare_customer_followup',
  requiredPermission: 'cs.read',
  inputSchema: prepareFollowupInput,
  async run(input) {
    const [row] = await db
      .select({
        id: customerSuccessAccounts.id,
        clientName: clients.name,
        healthScore: customerSuccessAccounts.healthScore,
        status: customerSuccessAccounts.status,
      })
      .from(customerSuccessAccounts)
      .innerJoin(clients, eq(customerSuccessAccounts.clientId, clients.id))
      .where(eq(customerSuccessAccounts.id, input.accountId))
      .limit(1);

    if (!row) {
      throw new AgentError('validation_error', 'Conta de Customer Success não encontrada.');
    }

    const draft = {
      accountId: row.id,
      clientName: row.clientName,
      draftMessage:
        `Olá ${row.clientName}, gostaríamos de saber como está sua experiência com a gente. ` +
        'Podemos agendar uma conversa rápida esta semana?',
    };

    return {
      success: true,
      summary: `Rascunho de follow-up preparado para a conta #${row.id} (não enviado).`,
      data: draft,
    };
  },
};

// cs.create_internal_followup_activity (EXECUTE) — ação interna segura
// (seção 25): reusa o mesmo núcleo transacional de
// POST /accounts/:id/activities.
const createFollowupActivityInput = z.object({
  accountId: z.coerce.number().int().positive('accountId inválido.'),
  title: z.string().trim().min(1, 'Título é obrigatório.').max(200),
  description: z.string().trim().max(10000).optional(),
});

export const csCreateInternalFollowupActivity: ToolDefinition<
  z.infer<typeof createFollowupActivityInput>
> = {
  handler: 'cs.create_internal_followup_activity',
  requiredPermission: 'cs.activities.create',
  inputSchema: createFollowupActivityInput,
  async run(input, ctx) {
    const result = await createFollowupActivity(
      input.accountId,
      {
        type: 'follow_up',
        title: input.title,
        description: input.description,
      },
      ctx.userId,
    );

    if (!result.ok) {
      throw new AgentError('execution_failed', 'Conta de Customer Success não encontrada.');
    }

    await audit({
      userId: ctx.userId,
      actorType: 'agent',
      actorId: ctx.agentSlug,
      action: 'agent.cs.create_internal_followup_activity',
      entityType: 'customer_success_activity',
      entityId: String(result.activity!.id),
      newData: result.activity,
      metadata: { executionId: ctx.executionId, csAccountId: input.accountId },
    });

    return {
      success: true,
      summary: `Atividade de follow-up registrada na conta #${input.accountId}.`,
      data: result.activity,
    };
  },
};

export function registerCsTools() {
  registerTool(csGetAtRiskAccounts);
  registerTool(csGetDueFollowups);
  registerTool(csGetExpansionOpportunities);
  registerTool(csPrepareCustomerFollowup);
  registerTool(csCreateInternalFollowupActivity);
}
