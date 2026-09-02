/**
 * Agentes v1.8 (correio.md secao 4) - catalogo determinístico de
 * thresholds, nunca numeros magicos espalhados pelo codigo. Fica em
 * codigo (não no modulo administrativo da v1.7) de proposito: "primeiro
 * queremos provar os workflows" - se demonstrarem necessidade real de
 * alteracao em runtime, promovidos depois ao sistema de settings da
 * v1.7 (correio.md v1.8 secao 4, correio.md v1.7 nao alterado aqui).
 */
export const DIRECTOR_THRESHOLDS = {
  /** Lead aberto sem next_action_at definido, criado ha mais de N dias -> sinal crm.lead_missing_follow_up. */
  leadStaleDays: 3,
  /** Tarefa com due_date dentro dos proximos N dias (ainda nao vencida) -> sinal projects.task_due_soon. */
  taskDueSoonDays: 2,
} as const;
