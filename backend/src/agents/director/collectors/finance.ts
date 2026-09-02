import { getOverdueEntries } from '../../../routes/financial/entries.js';

import type { OperationalSignal } from '../types.js';

/**
 * Agentes v1.8 (correio.md secao 3, Financeiro) — reaproveita
 * `getOverdueEntries()` (ja existente, ja usada por
 * director.get_business_overview), sem query nova.
 *
 * Sinal avaliado e NAO implementado: "cobrança próxima" (due soon, ainda
 * não vencida) — decisão de escopo, não limitação de dados: o correio.md
 * v1.8 pede para "provar os workflows" primeiro; overdue já cobre o caso
 * de maior sinal/urgência real. Fica como candidato natural de extensão
 * (mesmo padrão de getTasksDueSoon em projects.ts) se demonstrar
 * necessidade operacional.
 */
export async function collectFinanceSignals(now: Date): Promise<OperationalSignal[]> {
  const [overdueReceivables, overduePayables] = await Promise.all([
    getOverdueEntries('income'),
    getOverdueEntries('expense'),
  ]);

  const signals: OperationalSignal[] = [];

  for (const entry of overdueReceivables) {
    signals.push({
      id: `finance.receivable_overdue:${entry.id}`,
      type: 'finance.receivable_overdue',
      domain: 'finance',
      severity: 'warning',
      title: `Recebimento vencido: ${entry.description}`,
      description: `"${entry.description}"${entry.clientName ? ` (cliente ${entry.clientName})` : ''} venceu em ${entry.dueDate} e continua ${entry.status}.`,
      entityType: 'financial_entry',
      entityId: entry.id,
      detectedAt: now,
      metadata: { clientId: entry.clientId, dueDate: entry.dueDate, amount: entry.amount },
    });
  }

  for (const entry of overduePayables) {
    signals.push({
      id: `finance.payable_overdue:${entry.id}`,
      type: 'finance.payable_overdue',
      domain: 'finance',
      severity: 'warning',
      title: `Pagamento vencido: ${entry.description}`,
      description: `"${entry.description}" venceu em ${entry.dueDate} e continua ${entry.status}.`,
      entityType: 'financial_entry',
      entityId: entry.id,
      detectedAt: now,
      metadata: { dueDate: entry.dueDate, amount: entry.amount },
    });
  }

  return signals;
}
