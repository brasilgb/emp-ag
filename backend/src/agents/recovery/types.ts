/**
 * Agentes v2.4 (correio.md seção 6) — vocabulário fechado do resultado
 * de uma reconciliação. Nunca um boolean — cada resultado tem um
 * significado operacional distinto (seção 6: "não usar apenas
 * boolean").
 *
 * - recovered: o workflow foi trazido de volta a um estado 100%
 *   saudável (não usado nesta versão — nenhum adapter atual "conserta"
 *   um workflow sozinho, só o libera para retry seguro via o pipeline
 *   oficial; mantido no vocabulário para adapters futuros).
 * - retried: reservado para uma futura chamada automática ao pipeline
 *   oficial após reconciliar (não usado nesta versão — seção 8/9: "não
 *   chamar LLM automaticamente durante reconciliação"; a v2.4 só
 *   devolve o workflow a um estado retry-ável, nunca dispara o retry
 *   sozinha).
 * - reverted: o claim transitório foi removido/revertido (DELETE do
 *   `draft` ou `UPDATE` de volta a um status seguro) — o caso normal
 *   desta versão.
 * - marked_failed: reservado para um adapter futuro que precise marcar
 *   uma entidade como definitivamente falha (não usado nesta versão —
 *   nenhum workflow atual tem esse terminal; mantido no vocabulário).
 * - manual_attention: inconsistência real detectada, escalada para a
 *   Director Decision Queue (seção 13) — nunca "adivinhada".
 * - skipped: não havia mais nada a reconciliar (já resolvido por outro
 *   processo, ou não estava mais stale no momento da tentativa) — nunca
 *   um erro, é o resultado esperado de uma corrida perdida com
 *   segurança (seção 10/11/14).
 */
export const RECOVERY_RESULTS = ['recovered', 'retried', 'reverted', 'marked_failed', 'manual_attention', 'skipped'] as const;
export type RecoveryResult = (typeof RECOVERY_RESULTS)[number];

export const WORKFLOW_TYPES = ['initiative', 'executive_review', 'strategic_memory'] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

/** Um candidato a stale, encontrado por `adapter.detectStale()` — ainda não reconciliado. */
export interface StaleCandidate {
  workflowType: WorkflowType;
  entityId: number;
  previousState: string;
  ageSeconds: number;
  /** Descrição curta e determinística do problema detectado (nunca inventada — sempre um fato observável). */
  problem: string;
}

/** Resultado de UMA tentativa de reconciliação (seção 6: entityType/entityId/previousState/result/reason/timestamp). */
export interface RecoveryItemResult {
  workflowType: WorkflowType;
  entityId: number;
  previousState: string;
  result: RecoveryResult;
  reason: string;
  timestamp: string;
}

/**
 * Agentes v2.4 (correio.md seção 5) — contrato que cada adapter
 * implementa para SUA própria entidade. O core (`recovery-service.ts`)
 * nunca conhece detalhes internos das tabelas — só chama estes dois
 * métodos.
 */
export interface RecoveryAdapter {
  workflowType: WorkflowType;
  detectStale(thresholdSeconds: number): Promise<StaleCandidate[]>;
  /**
   * Reconcilia UM candidato. `dryRun=true` NUNCA escreve no banco — só
   * calcula e devolve qual seria a ação (seção 20/21: dry-run sem side
   * effects).
   */
  reconcile(candidate: StaleCandidate, params: { thresholdSeconds: number; dryRun: boolean; actorUserId: number | null }): Promise<RecoveryItemResult>;
}
