import type { Paginated } from "@/types/shared";
import type {
  Agent,
  AgentApproval,
  AgentConversation,
  AgentConversationDetail,
  AgentExecution,
  AgentTool,
  AgentToolForAgent,
  ApprovalStatus,
  ChatResponse,
  ExecutionStatus,
  HumanVerdict,
  InterpreterStats,
} from "@/types/agents";

import { apiFetch, toQueryString } from "./http";

export interface ExecuteToolInput {
  agentSlug: string;
  toolHandler: string;
  input?: Record<string, unknown>;
  conversationId?: number;
  idempotencyKey?: string;
}

export interface ExecuteToolResponse {
  status: "completed" | "waiting_approval";
  executionId: number;
  approvalId?: number;
  idempotentReplay?: boolean;
  result?: { success: boolean; summary: string; data: unknown; metadata?: Record<string, unknown> };
  message?: string;
}

export interface ListExecutionsParams {
  page?: number;
  limit?: number;
  status?: ExecutionStatus;
  agentId?: number;
}

export interface ListApprovalsParams {
  page?: number;
  limit?: number;
  status?: ApprovalStatus;
}

export function listAgents(): Promise<{ data: Agent[] }> {
  return apiFetch("/api/agents");
}

export function getAgent(id: number): Promise<{ data: Agent }> {
  return apiFetch(`/api/agents/${id}`);
}

export function listAgentTools(params: { department?: string } = {}): Promise<{ data: AgentTool[] }> {
  return apiFetch(`/api/agents/tools${toQueryString({ ...params })}`);
}

export function getAgentTools(agentId: number): Promise<{ data: AgentToolForAgent[] }> {
  return apiFetch(`/api/agents/${agentId}/tools`);
}

export function executeTool(input: ExecuteToolInput): Promise<ExecuteToolResponse> {
  return apiFetch("/api/agents/execute", { method: "POST", body: JSON.stringify(input) });
}

export function listExecutions(params: ListExecutionsParams = {}): Promise<Paginated<AgentExecution>> {
  return apiFetch(`/api/agents/executions${toQueryString({ ...params })}`);
}

export function getExecution(id: number): Promise<{ data: AgentExecution }> {
  return apiFetch(`/api/agents/executions/${id}`);
}

export function listApprovals(params: ListApprovalsParams = {}): Promise<Paginated<AgentApproval>> {
  return apiFetch(`/api/agents/approvals${toQueryString({ ...params })}`);
}

export function approveApproval(id: number, note?: string): Promise<unknown> {
  return apiFetch(`/api/agents/approvals/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function rejectApproval(id: number, note?: string): Promise<unknown> {
  return apiFetch(`/api/agents/approvals/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function listConversations(
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<AgentConversation>> {
  return apiFetch(`/api/agents/conversations${toQueryString({ ...params })}`);
}

export function createConversation(title?: string): Promise<{ data: AgentConversation }> {
  return apiFetch("/api/agents/conversations", { method: "POST", body: JSON.stringify({ title }) });
}

export function getConversation(id: number): Promise<{ data: AgentConversationDetail }> {
  return apiFetch(`/api/agents/conversations/${id}`);
}

export function sendChatMessage(input: { conversationId?: number; message: string }): Promise<ChatResponse> {
  return apiFetch("/api/agents/chat", { method: "POST", body: JSON.stringify(input) });
}

// v1.1 — LLM Interpreter + Shadow Mode (seção 27/28).
export function getInterpreterStats(): Promise<InterpreterStats> {
  return apiFetch("/api/agents/interpreter/stats");
}

// Seção 30 — feedback humano sobre uma interpretação. Nunca altera
// prompt/router/model; é só avaliação (agent.executions.manage).
export function reviewInterpretation(id: number, verdict: HumanVerdict): Promise<unknown> {
  return apiFetch(`/api/agents/interpreter/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ verdict }),
  });
}
