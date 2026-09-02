import { listOpenLeads } from '../../../routes/crm/leads.js';

import { DIRECTOR_THRESHOLDS } from '../thresholds.js';
import type { OperationalSignal } from '../types.js';

/**
 * Agentes v1.8 (correio.md secao 3, CRM) — reaproveita `listOpenLeads()`
 * (ja existente, ja usada por director.get_business_overview) e
 * classifica em memoria — nunca uma query SQL nova aqui. `now` sempre
 * recebido do chamador (correio.md secao 17 — testes com relogio
 * controlado).
 *
 * Sinais avaliados e NAO implementados (registrado no relatorio de
 * entrega): "lead parado em uma etapa do pipeline" (exigiria rastrear
 * quando o lead entrou no estagio atual — nao existe hoje, so
 * updated_at do lead inteiro, que muda por qualquer edicao, nao so
 * mudanca de estagio); "cliente sem contato recente" (ja coberto pelo
 * dominio support via customer_success_accounts.next_contact_at, que
 * modela exatamente isso — nao duplicado aqui); "atividade CRM vencida"
 * (crm_activities nao tem due date, so occurred_at — e um log do que ja
 * aconteceu, nao uma pendencia futura).
 */
export async function collectCrmSignals(now: Date): Promise<OperationalSignal[]> {
  const openLeads = await listOpenLeads();
  const signals: OperationalSignal[] = [];
  const staleThreshold = new Date(now.getTime() - DIRECTOR_THRESHOLDS.leadStaleDays * 24 * 60 * 60 * 1000);

  for (const lead of openLeads) {
    if (lead.nextActionAt) {
      if (new Date(lead.nextActionAt) < now) {
        signals.push({
          id: `crm.lead_follow_up_overdue:${lead.id}`,
          type: 'crm.lead_follow_up_overdue',
          domain: 'crm',
          severity: 'warning',
          title: `Follow-up vencido: ${lead.name}`,
          description: `Follow-up de "${lead.name}"${lead.companyName ? ` (${lead.companyName})` : ''} estava previsto para ${new Date(lead.nextActionAt).toLocaleDateString('pt-BR')} e ainda não ocorreu.`,
          entityType: 'lead',
          entityId: lead.id,
          detectedAt: now,
          metadata: { nextActionAt: lead.nextActionAt, ownerName: lead.ownerName, stageName: lead.stageName },
        });
      }
    } else if (new Date(lead.createdAt) < staleThreshold) {
      signals.push({
        id: `crm.lead_missing_follow_up:${lead.id}`,
        type: 'crm.lead_missing_follow_up',
        domain: 'crm',
        severity: 'attention',
        title: `Lead sem follow-up definido: ${lead.name}`,
        description: `"${lead.name}"${lead.companyName ? ` (${lead.companyName})` : ''} está aberto há mais de ${DIRECTOR_THRESHOLDS.leadStaleDays} dias sem nenhum follow-up agendado.`,
        entityType: 'lead',
        entityId: lead.id,
        detectedAt: now,
        metadata: { createdAt: lead.createdAt, ownerName: lead.ownerName, stageName: lead.stageName },
      });
    }
  }

  return signals;
}
