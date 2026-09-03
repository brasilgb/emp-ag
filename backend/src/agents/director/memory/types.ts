/**
 * Agentes v2.3 (correio.md seção 2) — vocabulário fechado da Strategic
 * Memory. Mesmo estilo de `reviews/types.ts` (arrays `as const` + tipo
 * derivado), única fonte de verdade reaproveitada por schema Zod, rota e
 * frontend.
 */
export const MEMORY_TYPES = ['initiative_outcome', 'strategic_lesson', 'decision_outcome', 'recurring_pattern'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

// 'draft' é adição documentada em agent-strategic-memories.ts — o
// correio.md sugeriu só active/superseded/archived.
export const MEMORY_STATUSES = ['draft', 'active', 'superseded', 'archived'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_IMPORTANCE_LEVELS = ['low', 'medium', 'high'] as const;
export type MemoryImportance = (typeof MEMORY_IMPORTANCE_LEVELS)[number];

// Correio.md seção 9: "max 5 ou max 10 memories" — limite explícito,
// nunca histórico ilimitado enviado ao LLM.
export const DEFAULT_RELEVANT_MEMORIES_LIMIT = 5;
export const MAX_RELEVANT_MEMORIES_LIMIT = 10;

// Status que participam de recuperação/contexto normal (seção 28 item
// 10: "memórias arquivadas não contaminarem contexto"). `draft` também
// nunca entra — é um estado transitório sem conteúdo confiável ainda;
// `superseded` idem — foi substituída por uma versão mais recente.
export const CONTEXTUAL_MEMORY_STATUSES: readonly MemoryStatus[] = ['active'];

/**
 * Agentes v2.3 (correio.md seção 22) — ordem de precedência OBRIGATÓRIA,
 * documentada aqui como única fonte de verdade textual e aplicada em
 * código nos pontos relevantes:
 *
 * 1. Permissions/Authorization       → `security/permissions.ts` + `requirePermission()` nas rotas (sempre primeiro, no backend, nunca no frontend).
 * 2. Policy/Safety rules             → `policy/action-policy-evaluator.ts` (Executive Review/memória NUNCA a invocam nem a contornam).
 * 3. Human decisions/approvals       → `agent_approvals` (decisão humana já registrada nunca é revista por causa de uma memória).
 * 4. Current deterministic evidence  → `reviews/context.ts`/`memory/context.ts` (dados reais da execução atual).
 * 5. Current business context        → Goal/Initiative atuais (domínio, meta, racional).
 * 6. Historical strategic memory     → `getRelevantStrategicMemories()` (este módulo) — só chega até aqui.
 * 7. LLM interpretation              → única camada que PRODUZ texto novo (outcome/lesson/recommendation), sempre por último e sempre revisável.
 *
 * Nenhuma memória pode ultrapassar os níveis 1-5 — estruturalmente
 * garantido porque a Strategic Memory nunca é lida por nenhum código dos
 * níveis 1-3 (permissions/policy/approvals não importam este módulo).
 */
export const STRATEGIC_MEMORY_PRECEDENCE_ORDER = [
  'permissions_authorization',
  'policy_safety_rules',
  'human_decisions_approvals',
  'current_deterministic_evidence',
  'current_business_context',
  'historical_strategic_memory',
  'llm_interpretation',
] as const;
