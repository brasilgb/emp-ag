export type { Paginated, PaginationMeta } from "./shared";

export const AGENT_DEPARTMENTS = [
  "director",
  "sales",
  "projects",
  "finance",
  "support",
  "customer_success",
] as const;
export type AgentDepartment = (typeof AGENT_DEPARTMENTS)[number];

export const AGENT_STATUSES = ["active", "paused", "disabled"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AUTONOMY_LEVELS = ["read", "prepare", "execute", "approval_required"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const EXECUTION_STATUSES = [
  "pending",
  "running",
  "waiting_approval",
  "approved",
  "rejected",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired", "cancelled"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const CONVERSATION_STATUSES = ["active", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Agent {
  id: number;
  name: string;
  slug: string;
  department: AgentDepartment;
  description: string | null;
  systemPrompt: string | null;
  status: AgentStatus;
  isSystem: boolean;
  isActive: boolean;
  defaultAutonomyLevel: AutonomyLevel;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTool {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  department: AgentDepartment;
  autonomyLevel: AutonomyLevel;
  handler: string;
  isActive: boolean;
  isSensitive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentToolForAgent extends AgentTool {
  canUse: boolean;
  requiresApprovalOverride: boolean;
}

export interface AgentExecution {
  id: number;
  agentId: number;
  agentName: string;
  agentSlug: string;
  userId: number | null;
  userName: string | null;
  conversationId: number | null;
  toolId: number;
  toolHandler: string;
  toolName: string;
  status: ExecutionStatus;
  autonomyLevel: AutonomyLevel;
  input: unknown;
  output: unknown;
  error: { code: string; message: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AgentApproval {
  id: number;
  executionId: number;
  toolHandler: string;
  toolName: string;
  agentName: string | null;
  agentSlug: string | null;
  requestedForUserId: number | null;
  requestedForUserName: string | null;
  status: ApprovalStatus;
  reason: string | null;
  requestPayload: unknown;
  decisionPayload: unknown;
  approvedByUserId: number | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface AgentConversation {
  id: number;
  userId: number;
  title: string | null;
  status: ConversationStatus;
  context: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessage {
  id: number;
  conversationId: number;
  agentId: number | null;
  role: MessageRole;
  content: string;
  metadata: { toolHandler?: string; executionId?: number } | null;
  createdAt: string;
}

export interface AgentConversationDetail extends AgentConversation {
  messages: AgentMessage[];
}

export interface ChatResponse {
  conversationId: number;
  agent: { slug: string; name: string } | null;
  tool: string | null;
  message: string;
  data: unknown;
  executionId?: number;
  status?: string;
  clarificationRequired?: boolean;
}

// v1.1 — LLM Interpreter + Shadow Mode.
export const INTERPRETATION_CATEGORIES = [
  "match",
  "mismatch",
  "deterministic_unknown_llm_recognized",
  "both_unknown",
] as const;
export type InterpretationCategory = (typeof INTERPRETATION_CATEGORIES)[number];

// Seção 30 — feedback humano simples, nunca retreina o modelo automaticamente.
export const HUMAN_VERDICTS = ["correct", "incorrect"] as const;
export type HumanVerdict = (typeof HUMAN_VERDICTS)[number];

// Seção 30-bis — taxonomia curta de erro/classificação do LLM Interpreter.
// low_confidence/clarification são resultados válidos do modelo (não
// falhas de infra), mas ainda ganham uma classificação curta em `error`
// para observabilidade — nunca contam em `errors`, só em `errorsByType`.
export const INTERPRETATION_ERROR_TYPES = [
  "timeout",
  "provider_http_error",
  "provider_error",
  "invalid_json",
  "schema_validation_error",
  "invalid_agent",
  "invalid_tool",
  "invalid_arguments",
  "low_confidence",
  "clarification",
] as const;
export type InterpretationErrorType = (typeof INTERPRETATION_ERROR_TYPES)[number];

// Já sanitizado pelo backend (llm/error-classification.ts) antes de
// persistir — nunca contém API key/headers/credenciais. `statusCode` só
// existe para type === 'provider_http_error'.
export interface InterpretationError {
  type: InterpretationErrorType;
  message: string | null;
  statusCode?: number;
}

export interface InterpretationEntry {
  id: number;
  conversationId: number;
  userMessage: string | null;
  deterministicAgent: string | null;
  deterministicTool: string | null;
  llmAgent: string | null;
  llmTool: string | null;
  llmConfidence: string | null;
  matched: boolean | null;
  mode: "shadow" | "fallback";
  error: InterpretationError | null;
  category: InterpretationCategory;
  createdAt: string;
  humanVerdict: HumanVerdict | null;
  reviewedByUserId: number | null;
  reviewedByUserName: string | null;
  reviewedAt: string | null;
}

export interface InterpreterStats {
  llmEnabled: boolean;
  shadowMode: boolean;
  provider: string;
  model: string;
  total: number;
  matches: number;
  mismatches: number;
  // Nem um nem outro — fora do cálculo de match rate (seção 30-bis).
  bothUnknown: number;
  deterministicUnknownLlmRecognized: number;
  matchRate: number | null;
  averageConfidence: number | null;
  averageLatencyMs: number | null;
  timeouts: number;
  errors: number;
  errorsByType: Record<InterpretationErrorType, number>;
  reviewed: number;
  humanCorrect: number;
  humanIncorrect: number;
  humanAccuracy: number | null;
  recentInterpretations: InterpretationEntry[];
}
