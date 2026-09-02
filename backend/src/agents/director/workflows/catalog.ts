import type { OperationalSignal, SignalDomain } from '../types.js';

/**
 * Agentes v1.8 (correio.md secao 9) — templates deterministicos: cada um
 * define o dominio aceito e como montar o objetivo (texto livre) que vai
 * para o Planner ja existente. O workflow NUNCA define autorizacao — o
 * Policy Evaluator continua sendo a unica autoridade (correio.md secao
 * 9: "O workflow NAO define autorizacao").
 *
 * Granularidade por dominio (nao por tipo de sinal): os 5 nomes
 * sugeridos pelo correio.md sao literalmente por dominio
 * (crm.follow_up_stale_lead, projects.handle_overdue_task,
 * finance.review_overdue_item, support.review_stale_ticket) mais um
 * especial para o Job recorrente do proprio Diretor
 * (director.daily_operations_review, secao 11) — nao invocado via
 * "propose" sobre um sinal especifico, e o objetivo do Job agendado.
 */
export interface WorkflowTemplate {
  id: string;
  domain: SignalDomain;
  buildObjective: (signal: OperationalSignal) => string;
}

export const WORKFLOW_TEMPLATES: Record<Exclude<SignalDomain, 'agents'>, WorkflowTemplate> = {
  crm: {
    id: 'crm.follow_up_stale_lead',
    domain: 'crm',
    buildObjective: (signal) =>
      `${signal.title}. ${signal.description} Avalie a situação e registre a atividade de acompanhamento apropriada.`,
  },
  projects: {
    id: 'projects.handle_overdue_task',
    domain: 'projects',
    buildObjective: (signal) =>
      `${signal.title}. ${signal.description} Avalie a situação e proponha o próximo passo para desbloquear ou regularizar.`,
  },
  finance: {
    id: 'finance.review_overdue_item',
    domain: 'finance',
    buildObjective: (signal) =>
      `${signal.title}. ${signal.description} Analise a pendência e prepare o acompanhamento adequado.`,
  },
  support: {
    id: 'support.review_stale_ticket',
    domain: 'support',
    buildObjective: (signal) =>
      `${signal.title}. ${signal.description} Analise a situação e prepare a resposta/acompanhamento adequado.`,
  },
};

export const DIRECTOR_DAILY_REVIEW_WORKFLOW_ID = 'director.daily_operations_review';
export const DIRECTOR_DAILY_REVIEW_OBJECTIVE =
  'Gerar briefing operacional diário da agência e identificar situações que requerem atenção.';

export function getWorkflowTemplateForDomain(domain: SignalDomain): WorkflowTemplate | null {
  if (domain === 'agents') return null;
  return WORKFLOW_TEMPLATES[domain];
}

export function buildObjectiveForSignal(signal: OperationalSignal): string | null {
  const template = getWorkflowTemplateForDomain(signal.domain);
  return template ? template.buildObjective(signal) : null;
}
