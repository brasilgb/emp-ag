import { z } from 'zod';

import { getClientOrNull, getEntryOrNull } from '../../routes/financial/helpers.js';
import { getFinancialSummary } from '../../routes/financial/stats.js';
import { getOverdueEntries } from '../../routes/financial/entries.js';
import { registerTool } from '../tool-registry.js';
import type { ToolDefinition } from '../types.js';
import { AgentError } from '../errors.js';

const emptyInput = z.object({}).strict();

// finance.get_summary (READ) — reusa GET /financial/stats (seção 22).
export const financeGetSummary: ToolDefinition<Record<string, never>> = {
  handler: 'finance.get_summary',
  requiredPermission: 'financial.stats.read',
  inputSchema: emptyInput,
  async run(_input, _ctx) {
    const summary = await getFinancialSummary();

    return {
      success: true,
      summary: `A receber: R$ ${summary.receivablePending} · A pagar: R$ ${summary.payablePending} · Resultado do mês: R$ ${summary.resultThisMonth}`,
      data: summary,
    };
  },
};

// finance.get_overdue_receivables (READ) — reusa
// routes/financial/entries.ts:getOverdueEntries('income').
export const financeGetOverdueReceivables: ToolDefinition<Record<string, never>> = {
  handler: 'finance.get_overdue_receivables',
  requiredPermission: 'financial.read',
  inputSchema: emptyInput,
  async run() {
    const entries = await getOverdueEntries('income');

    return {
      success: true,
      summary: `${entries.length} recebimento(s) em atraso.`,
      data: entries,
    };
  },
};

// finance.get_overdue_payables (READ)
export const financeGetOverduePayables: ToolDefinition<Record<string, never>> = {
  handler: 'finance.get_overdue_payables',
  requiredPermission: 'financial.read',
  inputSchema: emptyInput,
  async run() {
    const entries = await getOverdueEntries('expense');

    return {
      success: true,
      summary: `${entries.length} pagamento(s) em atraso.`,
      data: entries,
    };
  },
};

// finance.prepare_payment_reminder (PREPARE) — só gera o rascunho de
// mensagem de cobrança/lembrete; nunca envia (seção 24/26).
const prepareReminderInput = z.object({
  entryId: z.coerce.number().int().positive('entryId inválido.'),
});

export const financePreparePaymentReminder: ToolDefinition<
  z.infer<typeof prepareReminderInput>
> = {
  handler: 'finance.prepare_payment_reminder',
  requiredPermission: 'financial.read',
  inputSchema: prepareReminderInput,
  async run(input) {
    const entry = await getEntryOrNull(input.entryId);

    if (!entry) {
      throw new AgentError('validation_error', 'Lançamento financeiro não encontrado.');
    }

    const client = entry.clientId ? await getClientOrNull(entry.clientId) : null;

    const draft = {
      entryId: entry.id,
      clientName: client?.name ?? null,
      amount: entry.amount,
      dueDate: entry.dueDate,
      draftMessage:
        `Olá${client ? ` ${client.name}` : ''}, identificamos um lançamento em aberto ` +
        `("${entry.description}") no valor de R$ ${entry.amount}, com vencimento em ${entry.dueDate}. ` +
        'Poderia nos confirmar a previsão de pagamento?',
    };

    return {
      success: true,
      summary: `Rascunho de lembrete preparado para o lançamento #${entry.id} (não enviado).`,
      data: draft,
    };
  },
};

export function registerFinanceTools() {
  registerTool(financeGetSummary);
  registerTool(financeGetOverdueReceivables);
  registerTool(financeGetOverduePayables);
  registerTool(financePreparePaymentReminder);
}
