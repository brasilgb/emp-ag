/**
 * Agentes v2.0 (correio.md secao 6: "Centralizar thresholds" / "Nenhum
 * numero magico espalhado") - mesmo padrao de
 * agents/director/decisions/thresholds.ts (v1.9): health e um algoritmo
 * determinístico baseado na comparacao entre progresso real e progresso
 * esperado pelo tempo decorrido (`deviation = progressPercent -
 * timeElapsedPercent`) - nunca delegado ao LLM.
 *
 * Racional: um Goal que progrediu 40% tendo decorrido 40% do prazo esta
 * `on_track` (deviation = 0); se decorreu 70% do prazo e so progrediu
 * 40%, ha um desvio de -30 pontos - `attention`/`at_risk`/`critical`
 * conforme a magnitude do atraso, mais peso extra quando o prazo ja
 * venceu sem conclusao.
 */
export const HEALTH_DEVIATION_THRESHOLDS = {
  /** deviation >= attentionAt (-10): on_track. */
  attentionAt: -10,
  /** attentionAt > deviation >= atRiskAt (-25): attention. */
  atRiskAt: -25,
  /** atRiskAt > deviation >= criticalAt (-45): at_risk. Abaixo disso: critical. */
  criticalAt: -45,
} as const;

/** Prazo vencido sem conclusao sempre vira, no minimo, at_risk (mesmo com deviation pequeno). */
export const OVERDUE_MINIMUM_HEALTH_RANK = 2; // indice em HEALTH_RANK abaixo

export const HEALTH_RANK = ['on_track', 'attention', 'at_risk', 'critical'] as const;

/** Recomendacoes de Initiative (correio.md secao 11) - so gerar quando o health for pelo menos este. */
export const RECOMMENDATION_MIN_HEALTH_RANK = 2; // at_risk ou critical
