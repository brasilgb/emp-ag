import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../db/index.js';
import { clients, supportTickets } from '../../db/schema/index.js';
import { addInternalNote } from '../../routes/support/messages.js';
import {
  getCriticalTickets,
  getOverdueTicketsList,
} from '../../routes/support/tickets.js';
import { audit } from '../../services/audit.js';
import { registerTool } from '../tool-registry.js';
import type { ToolDefinition } from '../types.js';
import { AgentError } from '../errors.js';

const emptyInput = z.object({}).strict();

// support.get_critical_tickets (READ)
export const supportGetCriticalTickets: ToolDefinition<Record<string, never>> = {
  handler: 'support.get_critical_tickets',
  requiredPermission: 'support.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getCriticalTickets();

    return {
      success: true,
      summary: `${rows.length} chamado(s) crítico(s) em aberto.`,
      data: rows,
    };
  },
};

// support.get_overdue_tickets (READ)
export const supportGetOverdueTickets: ToolDefinition<Record<string, never>> = {
  handler: 'support.get_overdue_tickets',
  requiredPermission: 'support.read',
  inputSchema: emptyInput,
  async run() {
    const rows = await getOverdueTicketsList();

    return {
      success: true,
      summary: `${rows.length} chamado(s) com SLA estourado.`,
      data: rows,
    };
  },
};

// support.prepare_ticket_response (PREPARE) — só gera o rascunho de
// resposta; nunca envia (seção 24/26).
const prepareResponseInput = z.object({
  ticketId: z.coerce.number().int().positive('ticketId inválido.'),
});

export const supportPrepareTicketResponse: ToolDefinition<
  z.infer<typeof prepareResponseInput>
> = {
  handler: 'support.prepare_ticket_response',
  requiredPermission: 'support.read',
  inputSchema: prepareResponseInput,
  async run(input) {
    const [row] = await db
      .select({
        id: supportTickets.id,
        title: supportTickets.title,
        status: supportTickets.status,
        priority: supportTickets.priority,
        clientName: clients.name,
      })
      .from(supportTickets)
      .innerJoin(clients, eq(supportTickets.clientId, clients.id))
      .where(eq(supportTickets.id, input.ticketId))
      .limit(1);

    if (!row) {
      throw new AgentError('validation_error', 'Chamado não encontrado.');
    }

    const draft = {
      ticketId: row.id,
      clientName: row.clientName,
      draftMessage:
        `Olá ${row.clientName}, obrigado por aguardar. Estamos analisando o chamado ` +
        `"${row.title}" e retornaremos em breve com uma atualização.`,
    };

    return {
      success: true,
      summary: `Rascunho de resposta preparado para o chamado #${row.id} (não enviado).`,
      data: draft,
    };
  },
};

// support.add_internal_note (EXECUTE) — ação interna segura (seção 25):
// reusa o mesmo núcleo transacional de POST /tickets/:id/messages para
// notas internas.
const addInternalNoteInput = z.object({
  ticketId: z.coerce.number().int().positive('ticketId inválido.'),
  content: z.string().trim().min(1, 'Conteúdo é obrigatório.').max(10000),
});

export const supportAddInternalNote: ToolDefinition<z.infer<typeof addInternalNoteInput>> = {
  handler: 'support.add_internal_note',
  requiredPermission: 'support.message',
  inputSchema: addInternalNoteInput,
  async run(input, ctx) {
    const result = await addInternalNote(input.ticketId, input.content, ctx.userId);

    if (!result.ok) {
      throw new AgentError('execution_failed', 'Chamado não encontrado.');
    }

    await audit({
      userId: ctx.userId,
      actorType: 'agent',
      actorId: ctx.agentSlug,
      action: 'agent.support.add_internal_note',
      entityType: 'support_message',
      entityId: String(result.message!.id),
      newData: result.message,
      metadata: { executionId: ctx.executionId, ticketId: input.ticketId },
    });

    return {
      success: true,
      summary: `Nota interna adicionada ao chamado #${input.ticketId}.`,
      data: result.message,
    };
  },
};

export function registerSupportTools() {
  registerTool(supportGetCriticalTickets);
  registerTool(supportGetOverdueTickets);
  registerTool(supportPrepareTicketResponse);
  registerTool(supportAddInternalNote);
}
