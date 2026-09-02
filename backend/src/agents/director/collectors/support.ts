import { getAtRiskAccounts, getDueFollowups } from '../../../routes/customer-success/accounts.js';
import { getCriticalTickets, getOverdueTicketsList } from '../../../routes/support/tickets.js';

import type { OperationalSignal } from '../types.js';

/**
 * Agentes v1.8 (correio.md secao 3, Suporte/Customer Success) —
 * reaproveita 4 funcoes ja existentes (getCriticalTickets/
 * getOverdueTicketsList/getAtRiskAccounts/getDueFollowups, todas ja
 * usadas por director.get_business_overview), sem query nova. CS entra
 * no dominio 'support' — o tipo OperationalSignal so tem os 4 dominios
 * do produto (crm/projects/finance/support), e o proprio correio.md
 * agrupa "Suporte / Customer Success" sob o mesmo titulo.
 */
export async function collectSupportSignals(now: Date): Promise<OperationalSignal[]> {
  const [criticalTickets, overdueTickets, atRiskAccounts, dueFollowups] = await Promise.all([
    getCriticalTickets(),
    getOverdueTicketsList(),
    getAtRiskAccounts(),
    getDueFollowups(),
  ]);

  const signals: OperationalSignal[] = [];

  for (const ticket of criticalTickets) {
    signals.push({
      id: `support.ticket_critical:${ticket.id}`,
      type: 'support.ticket_critical',
      domain: 'support',
      severity: 'critical',
      title: `Chamado crítico: ${ticket.title}`,
      description: `"${ticket.title}"${ticket.clientName ? ` (cliente ${ticket.clientName})` : ''} está com prioridade crítica e em aberto.`,
      entityType: 'support_ticket',
      entityId: ticket.id,
      detectedAt: now,
      metadata: { clientId: ticket.clientId, status: ticket.status, ownerName: ticket.ownerName },
    });
  }

  for (const ticket of overdueTickets) {
    signals.push({
      id: `support.ticket_overdue:${ticket.id}`,
      type: 'support.ticket_overdue',
      domain: 'support',
      severity: 'warning',
      title: `Chamado com SLA vencido: ${ticket.title}`,
      description: `"${ticket.title}"${ticket.clientName ? ` (cliente ${ticket.clientName})` : ''} passou do prazo de SLA.`,
      entityType: 'support_ticket',
      entityId: ticket.id,
      detectedAt: now,
      metadata: { clientId: ticket.clientId, status: ticket.status, priority: ticket.priority },
    });
  }

  for (const account of atRiskAccounts) {
    signals.push({
      id: `support.account_at_risk:${account.id}`,
      type: 'support.account_at_risk',
      domain: 'support',
      severity: 'critical',
      title: `Conta em risco: ${account.clientName}`,
      description: `A conta de "${account.clientName}" está classificada como em risco (health score ${account.healthScore}).`,
      entityType: 'customer_success_account',
      entityId: account.id,
      detectedAt: now,
      metadata: { clientId: account.clientId, healthScore: account.healthScore, churnRisk: account.churnRisk },
    });
  }

  for (const account of dueFollowups) {
    signals.push({
      id: `support.follow_up_due:${account.id}`,
      type: 'support.follow_up_due',
      domain: 'support',
      severity: 'attention',
      title: `Follow-up de CS pendente: ${account.clientName}`,
      description: `A conta de "${account.clientName}" tem follow-up de Customer Success pendente desde ${account.nextContactAt ? new Date(account.nextContactAt).toLocaleDateString('pt-BR') : 'data não definida'}.`,
      entityType: 'customer_success_account',
      entityId: account.id,
      detectedAt: now,
      metadata: { clientId: account.clientId, nextContactAt: account.nextContactAt },
    });
  }

  return signals;
}
