/**
 * Agentes v1.9 (correio.md secao 8: "Centralizar pesos e thresholds em
 * catalogo/configuracao" / secao 10: "Centralizar thresholds") - nenhum
 * numero magico espalhado pelas regras de priorizacao/urgencia/escalada.
 * Mesmo racional de agents/director/thresholds.ts (v1.8) e
 * agents/settings/catalog.ts (v1.7): fica em codigo nesta versao (nao
 * promovido ao sistema de settings da v1.7 - "provar os workflows"
 * primeiro, mesma decisao da v1.8).
 */
export const PRIORITY_WEIGHTS = {
  severity: { critical: 100, warning: 60, attention: 30, info: 10 },
  impact: { high: 30, medium: 15, low: 5 },
  urgency: { immediate: 30, soon: 15, normal: 5 },
  // Aging: 2 pontos por dia em aberto, capado em 40 (20 dias) - um item
  // muito antigo nao deve dominar o ranking sozinho so por idade.
  agingPointsPerDay: 2,
  agingCap: 40,
  // Recorrencia: 5 pontos por ocorrencia ALEM da primeira, capado em 30
  // (7 ocorrencias) - mesma logica de nao deixar uma unica dimensao
  // dominar o score.
  recurrencePointsPerOccurrence: 5,
  recurrenceCap: 30,
} as const;

export const ESCALATION_THRESHOLDS = {
  /** Dias em aberto para um item 'critical' escalar (requiresHumanAttention=true) mesmo sem approval pendente. */
  criticalAgingDays: 1,
  /** Ocorrencias para qualquer item escalar por recorrencia, independente de severidade. */
  recurrenceCount: 5,
} as const;

/**
 * Impact por signalType (correio.md secao 9) - nao inventado pelo LLM,
 * regra fechada por tipo. `finance.*` tem override dinamico por valor
 * real (ver resolveImpact) quando `metadata.amount` estiver disponivel
 * — os demais tipos usam sempre o valor fixo abaixo.
 */
export const IMPACT_BY_SIGNAL_TYPE: Record<string, 'high' | 'medium' | 'low'> = {
  'support.ticket_critical': 'high',
  'support.account_at_risk': 'high',
  'projects.project_overdue': 'high',
  'agents.job_circuit_open': 'high',

  'finance.receivable_overdue': 'medium',
  'finance.payable_overdue': 'medium',
  'projects.task_overdue': 'medium',
  'projects.task_blocked': 'medium',
  'support.ticket_overdue': 'medium',
  'support.follow_up_due': 'medium',
  'crm.lead_follow_up_overdue': 'medium',
  'agents.approval_pending': 'medium',

  'crm.lead_missing_follow_up': 'low',
  'projects.task_due_soon': 'low',
  'projects.task_unassigned': 'low',
};

/** Limiares reais de valor financeiro (correio.md seção 9 — "se esse valor estiver realmente disponível no sinal", já está: collectFinanceSignals grava `metadata.amount`). */
export const FINANCE_IMPACT_AMOUNT_THRESHOLDS = {
  high: 5000,
  medium: 1000,
} as const;

/**
 * agents.incident.<reason> tem impact por reason (o `type` do sinal é
 * `agents.incident.${incident.type}`, ver agents/director/collectors/agents.ts).
 */
export const INCIDENT_REASON_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
  autonomy_circuit_open: 'high',
  autonomous_cycle_detected: 'high',
  autonomy_depth_exceeded: 'medium',
  autonomy_chain_budget_exceeded: 'medium',
  autonomous_rate_limit_exceeded: 'medium',
  job_repeated_failure: 'medium',
  event_delivery_failed: 'low',
};

/**
 * Urgency por signalType (correio.md secao 10) - baseline estatico por
 * tipo (o sinal ja representa, por natureza, "vencido"/"critico agora"
 * vs "aviso antecipado"); a dimensao continua de tempo real fica a cargo
 * de `aging`, calculado sobre o proprio ciclo de vida do Decision Item
 * (first_detected_at -> now), nao sobre datas heterogeneas de cada
 * dominio (due_date/sla_due_at/next_action_at...) - separacao de
 * responsabilidades documentada: urgency = "que tipo de situacao e essa"
 * (fixo por tipo), aging = "ha quanto tempo estamos sabendo disso" (o
 * relogio real, sempre com `now` parametrizavel).
 */
export const URGENCY_BY_SIGNAL_TYPE: Record<string, 'immediate' | 'soon' | 'normal'> = {
  'support.ticket_critical': 'immediate',
  'support.account_at_risk': 'immediate',
  'agents.job_circuit_open': 'immediate',
  'finance.receivable_overdue': 'immediate',
  'finance.payable_overdue': 'immediate',
  'projects.task_overdue': 'immediate',
  'projects.project_overdue': 'immediate',
  'support.ticket_overdue': 'immediate',
  'crm.lead_follow_up_overdue': 'immediate',

  'projects.task_due_soon': 'soon',
  'support.follow_up_due': 'soon',
  'projects.task_blocked': 'soon',
  'agents.approval_pending': 'soon',

  'crm.lead_missing_follow_up': 'normal',
  'projects.task_unassigned': 'normal',
};

export const INCIDENT_REASON_URGENCY: Record<string, 'immediate' | 'soon' | 'normal'> = {
  autonomy_circuit_open: 'immediate',
  autonomous_cycle_detected: 'immediate',
  autonomy_depth_exceeded: 'soon',
  autonomy_chain_budget_exceeded: 'soon',
  autonomous_rate_limit_exceeded: 'soon',
  job_repeated_failure: 'soon',
  event_delivery_failed: 'normal',
};
