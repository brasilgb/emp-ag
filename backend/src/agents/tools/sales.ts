import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../db/index.js';
import { leads } from '../../db/schema/index.js';
import { listOpenLeads } from '../../routes/crm/leads.js';
import { getPipelineSummary } from '../../routes/crm/pipeline.js';
import { registerTool } from '../tool-registry.js';
import type { ToolDefinition } from '../types.js';
import { AgentError } from '../errors.js';

const emptyInput = z.object({}).strict();

// sales.get_pipeline_summary (READ)
export const salesGetPipelineSummary: ToolDefinition<Record<string, never>> = {
  handler: 'sales.get_pipeline_summary',
  requiredPermission: 'leads.read',
  inputSchema: emptyInput,
  async run() {
    const stages = await getPipelineSummary();
    const totalLeads = stages.reduce((sum, stage) => sum + stage.leadCount, 0);

    return {
      success: true,
      summary: `${totalLeads} lead(s) no funil, distribuídos em ${stages.length} estágio(s).`,
      data: stages,
    };
  },
};

// sales.list_open_leads (READ)
export const salesListOpenLeads: ToolDefinition<Record<string, never>> = {
  handler: 'sales.list_open_leads',
  requiredPermission: 'leads.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await listOpenLeads();

    return {
      success: true,
      summary: `${rows.length} lead(s) em aberto.`,
      data: rows,
    };
  },
};

// sales.prepare_lead_followup (PREPARE) — só gera o rascunho; nunca envia
// (seção 24/26).
const prepareFollowupInput = z.object({
  leadId: z.coerce.number().int().positive('leadId inválido.'),
});

export const salesPrepareLeadFollowup: ToolDefinition<z.infer<typeof prepareFollowupInput>> = {
  handler: 'sales.prepare_lead_followup',
  requiredPermission: 'leads.read',
  inputSchema: prepareFollowupInput,
  async run(input) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId)).limit(1);

    if (!lead) {
      throw new AgentError('validation_error', 'Lead não encontrado.');
    }

    const draft = {
      leadId: lead.id,
      leadName: lead.name,
      draftMessage:
        `Olá ${lead.name}, tudo bem? Gostaríamos de dar continuidade à nossa conversa ` +
        'e entender se ainda podemos ajudar. Podemos conversar esta semana?',
    };

    return {
      success: true,
      summary: `Rascunho de follow-up preparado para o lead #${lead.id} (não enviado).`,
      data: draft,
    };
  },
};

export function registerSalesTools() {
  registerTool(salesGetPipelineSummary);
  registerTool(salesListOpenLeads);
  registerTool(salesPrepareLeadFollowup);
}
