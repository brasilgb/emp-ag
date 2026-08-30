import type {
  ApprovalStatus,
  AutonomyLevel,
  ChatResponse,
  ExecutionStatus,
  HumanVerdict,
  InterpretationCategory,
  InterpretationErrorType,
} from "@/types/agents";

/**
 * Helpers puros do módulo Agentes (seção 58) — nenhum componente/hook deve
 * duplicar estes rótulos ou essa lógica de derivação. Mesmo padrão de
 * lib/support/derived.ts: funções puras, testadas isoladamente, sem
 * renderização.
 */

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  pending: "Pendente",
  running: "Em execução",
  waiting_approval: "Aguardando aprovação",
  approved: "Aprovada",
  rejected: "Rejeitada",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

export function executionStatusLabel(status: ExecutionStatus): string {
  return EXECUTION_STATUS_LABELS[status] ?? status;
}

export const AUTONOMY_LEVEL_LABELS: Record<AutonomyLevel, string> = {
  read: "Somente leitura",
  prepare: "Preparação",
  execute: "Execução automática",
  approval_required: "Requer aprovação",
};

export function autonomyLevelLabel(level: AutonomyLevel): string {
  return AUTONOMY_LEVEL_LABELS[level] ?? level;
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// approval_required é sempre destacado como o nível mais sensível — nunca
// deve passar despercebido na UI (seção 13).
export function autonomyLevelBadgeVariant(level: AutonomyLevel): BadgeVariant {
  switch (level) {
    case "approval_required":
      return "destructive";
    case "execute":
      return "default";
    case "prepare":
      return "secondary";
    case "read":
    default:
      return "outline";
  }
}

export type DerivedApprovalState =
  | "pending"
  | "expiring_soon"
  | "expired"
  | "approved"
  | "rejected"
  | "cancelled";

const EXPIRING_SOON_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h

/**
 * Estado de aprovação exibido na UI. "expiring_soon"/"expired" são sempre
 * derivados de expires_at no momento da leitura (mesmo princípio de
 * slaState em lib/support/derived.ts) — o backend só persiste os 5 status
 * reais da colun a (seção 12); a UI refina "pending" com uma leitura de
 * proximidade do vencimento.
 */
export function approvalState(
  approval: { status: ApprovalStatus; expiresAt: string | null },
  now: Date = new Date(),
): DerivedApprovalState {
  if (approval.status !== "pending") {
    return approval.status;
  }

  if (!approval.expiresAt) {
    return "pending";
  }

  const expiresAt = new Date(approval.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return "pending";
  }

  const remainingMs = expiresAt.getTime() - now.getTime();

  if (remainingMs < 0) {
    return "expired";
  }

  if (remainingMs <= EXPIRING_SOON_THRESHOLD_MS) {
    return "expiring_soon";
  }

  return "pending";
}

export const APPROVAL_STATE_LABELS: Record<DerivedApprovalState, string> = {
  pending: "Pendente",
  expiring_soon: "Expira em breve",
  expired: "Expirada",
  approved: "Aprovada",
  rejected: "Rejeitada",
  cancelled: "Cancelada",
};

export function approvalStateLabel(state: DerivedApprovalState): string {
  return APPROVAL_STATE_LABELS[state] ?? state;
}

const UNKNOWN_INTENT_FALLBACK = "Não consegui identificar com segurança qual área deve tratar esta solicitação.";

export interface FormattedChatResponse {
  text: string;
  transparency: string | null;
}

/**
 * Seção 34/42: o backend já devolve `message` limpo (só o texto de
 * resposta) e `agent`/`tool` em campos separados — esta função nunca
 * reformula o texto, só decide a legenda discreta de transparência
 * ("Agente Financeiro · Consultou: finance.get_summary") a partir desses
 * campos, e o fallback de intenção desconhecida quando `message` vem
 * vazio. Nunca expõe parâmetros/dados internos da tool, só o handler.
 */
export function formatChatResponse(response: Pick<ChatResponse, "agent" | "tool" | "message">): FormattedChatResponse {
  const text = response.message || UNKNOWN_INTENT_FALLBACK;

  if (!response.agent || !response.tool) {
    return { text, transparency: null };
  }

  return { text, transparency: `${response.agent.name} · Consultou: ${response.tool}` };
}

// Seção 29/30/30-bis — as quatro categorias que importam para quem avalia
// o LLM Interpreter. `deterministic_unknown_llm_recognized`
// (determinístico não reconheceu nada mas o LLM achou uma tool válida)
// nunca deve ser lido como um "erro" de divergência qualquer — é
// justamente o caso mais interessante para validar antes de ativar
// fallback. `both_unknown` (nenhum dos dois reconheceu nada) não é match
// nem mismatch — fica fora do match rate no backend, e também não deve
// ler como "os dois concordaram" (INTERPRETATION_CATEGORY_LABELS abaixo
// nomeia isso explicitamente, para não confundir com `match`).
export const INTERPRETATION_CATEGORY_LABELS: Record<InterpretationCategory, string> = {
  match: "Concordância",
  mismatch: "Divergência",
  deterministic_unknown_llm_recognized: "Determinístico não reconheceu · LLM reconheceu",
  both_unknown: "Nenhum dos dois reconheceu",
};

export function interpretationCategoryLabel(category: InterpretationCategory | null): string {
  if (!category) return "Não comparável";
  return INTERPRETATION_CATEGORY_LABELS[category] ?? category;
}

export const HUMAN_VERDICT_LABELS: Record<HumanVerdict, string> = {
  correct: "Correto",
  incorrect: "Incorreto",
};

export function humanVerdictLabel(verdict: HumanVerdict | null): string | null {
  if (!verdict) return null;
  return HUMAN_VERDICT_LABELS[verdict] ?? verdict;
}

// Seção 30-bis — rótulos curtos da taxonomia de error/classificação.
export const INTERPRETATION_ERROR_TYPE_LABELS: Record<InterpretationErrorType, string> = {
  timeout: "Timeout",
  provider_http_error: "Erro HTTP do provider",
  provider_error: "Falha ao chamar o provider",
  invalid_json: "JSON inválido",
  schema_validation_error: "Saída fora do schema",
  invalid_agent: "Agente inválido",
  invalid_tool: "Tool inválida",
  invalid_arguments: "Argumentos inválidos",
  low_confidence: "Confiança baixa",
  clarification: "Pediu esclarecimento",
};

export function interpretationErrorTypeLabel(type: InterpretationErrorType): string {
  return INTERPRETATION_ERROR_TYPE_LABELS[type] ?? type;
}
