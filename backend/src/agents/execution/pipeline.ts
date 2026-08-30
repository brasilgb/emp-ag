import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentApprovals,
  agentExecutions,
  agentToolPermissions,
  agentTools,
  agents,
} from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { getTool } from '../tool-registry.js';
import type { AutonomyLevel, ToolResult } from '../types.js';
import type { AgentErrorCode } from '../errors.js';
import { getUserPermissionSlugs } from '../security/permissions.js';

export interface ExecuteToolParams {
  userId: number;
  agentSlug: string;
  toolHandler: string;
  input: unknown;
  conversationId?: number | null;
  idempotencyKey?: string | null;
}

export interface ExecuteToolOutcome {
  idempotentReplay: boolean;
  executionId: number | null;
  status: 'completed' | 'failed' | 'waiting_approval' | 'rejected';
  approvalId: number | null;
  result: ToolResult | null;
  error: { code: AgentErrorCode; message: string } | null;
}

const APPROVAL_EXPIRES_MS = 24 * 60 * 60 * 1000;

function rejected(code: AgentErrorCode, message: string): ExecuteToolOutcome {
  return {
    idempotentReplay: false,
    executionId: null,
    status: 'rejected',
    approvalId: null,
    result: null,
    error: { code, message },
  };
}

/**
 * Seção 30 — fluxo completo:
 * authenticate (já feito pelo preHandler da rota)
 * → agents.use (idem)
 * → resolve agent
 * → resolve tool
 * → verify agent-tool permission
 * → verify user permission
 * → verify autonomy
 * → approval if required
 * → execute handler
 * → log
 *
 * Usada por POST /agents/execute e pelo fluxo de POST /agents/chat após a
 * interpretação (seções 3/5 do plano).
 */
export async function executeTool(params: ExecuteToolParams): Promise<ExecuteToolOutcome> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.slug, params.agentSlug))
    .limit(1);

  if (!agent || !agent.isActive || agent.status !== 'active') {
    await audit({
      userId: params.userId,
      actorType: 'user',
      actorId: String(params.userId),
      action: 'agent.execution.rejected',
      metadata: { reason: 'agent_not_found', agentSlug: params.agentSlug, toolHandler: params.toolHandler },
    });

    return rejected('agent_not_found', 'Agente não encontrado ou indisponível.');
  }

  const [dbTool] = await db
    .select()
    .from(agentTools)
    .where(eq(agentTools.handler, params.toolHandler))
    .limit(1);

  const registryTool = getTool(params.toolHandler);

  if (!dbTool || !dbTool.isActive || !registryTool) {
    await audit({
      userId: params.userId,
      actorType: 'user',
      actorId: String(params.userId),
      action: 'agent.execution.rejected',
      metadata: { reason: 'tool_not_found', agentId: agent.id, toolHandler: params.toolHandler },
    });

    return rejected('tool_not_found', 'Ferramenta inexistente ou indisponível.');
  }

  // Idempotência (seção 48): retry com a mesma chave retorna o resultado
  // já obtido, sem executar de novo.
  if (params.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(agentExecutions)
      .where(
        and(
          eq(agentExecutions.agentId, agent.id),
          eq(agentExecutions.toolId, dbTool.id),
          eq(agentExecutions.idempotencyKey, params.idempotencyKey),
        ),
      )
      .limit(1);

    if (existing) {
      return outcomeFromExecutionRow(existing, true);
    }
  }

  let execution: typeof agentExecutions.$inferSelect;

  try {
    [execution] = await db
      .insert(agentExecutions)
      .values({
        agentId: agent.id,
        userId: params.userId,
        conversationId: params.conversationId ?? null,
        toolId: dbTool.id,
        status: 'pending',
        autonomyLevel: dbTool.autonomyLevel,
        input: params.input,
        idempotencyKey: params.idempotencyKey ?? null,
      })
      .returning();
  } catch {
    // Corrida entre duas requisições concorrentes com a mesma
    // idempotencyKey: a segunda perde a inserção (índice único parcial),
    // relê e devolve o resultado da primeira.
    if (params.idempotencyKey) {
      const [existing] = await db
        .select()
        .from(agentExecutions)
        .where(
          and(
            eq(agentExecutions.agentId, agent.id),
            eq(agentExecutions.toolId, dbTool.id),
            eq(agentExecutions.idempotencyKey, params.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        return outcomeFromExecutionRow(existing, true);
      }
    }

    throw new Error('Falha ao registrar execução do agente.');
  }

  // Dupla autorização (seção 28): permissão do agente E permissão do
  // usuário — nenhuma das duas basta sozinha.
  const [agentToolPermission] = await db
    .select()
    .from(agentToolPermissions)
    .where(
      and(
        eq(agentToolPermissions.agentId, agent.id),
        eq(agentToolPermissions.toolId, dbTool.id),
      ),
    )
    .limit(1);

  if (!agentToolPermission || !agentToolPermission.canUse) {
    return failExecution(
      execution,
      'permission_denied',
      'Este agente não está autorizado a usar esta ferramenta.',
    );
  }

  const userPermissions = await getUserPermissionSlugs(params.userId);

  if (!userPermissions.has(registryTool.requiredPermission)) {
    return failExecution(
      execution,
      'permission_denied',
      'Você não possui permissão para executar esta ação.',
    );
  }

  const parsedInput = registryTool.inputSchema.safeParse(params.input ?? {});

  if (!parsedInput.success) {
    return failExecution(
      execution,
      'validation_error',
      parsedInput.error.issues[0]?.message ?? 'Dados inválidos para esta ferramenta.',
    );
  }

  // Autonomia efetiva (seção 13): approval_required se a tool for assim
  // configurada, marcada como sensível, ou se o par agente/tool força
  // aprovação mesmo para uma tool que normalmente não exigiria.
  const effectiveAutonomy: AutonomyLevel =
    dbTool.autonomyLevel === 'approval_required' ||
    dbTool.isSensitive ||
    agentToolPermission.requiresApprovalOverride
      ? 'approval_required'
      : (dbTool.autonomyLevel as AutonomyLevel);

  if (effectiveAutonomy !== execution.autonomyLevel) {
    [execution] = await db
      .update(agentExecutions)
      .set({ autonomyLevel: effectiveAutonomy })
      .where(eq(agentExecutions.id, execution.id))
      .returning();
  }

  if (effectiveAutonomy === 'approval_required') {
    [execution] = await db
      .update(agentExecutions)
      .set({ status: 'waiting_approval' })
      .where(eq(agentExecutions.id, execution.id))
      .returning();

    const [approval] = await db
      .insert(agentApprovals)
      .values({
        executionId: execution.id,
        requestedByAgentId: agent.id,
        requestedForUserId: params.userId,
        status: 'pending',
        requestPayload: parsedInput.data,
        expiresAt: new Date(Date.now() + APPROVAL_EXPIRES_MS),
      })
      .returning();

    await audit({
      userId: params.userId,
      actorType: 'user',
      actorId: String(params.userId),
      action: 'agent.approval.requested',
      entityType: 'agent_approval',
      entityId: String(approval.id),
      newData: approval,
      metadata: { executionId: execution.id, toolHandler: params.toolHandler },
    });

    return {
      idempotentReplay: false,
      executionId: execution.id,
      status: 'waiting_approval',
      approvalId: approval.id,
      result: null,
      error: null,
    };
  }

  return runHandlerAndLog(execution, agent, dbTool, parsedInput.data, params.userId);
}

function outcomeFromExecutionRow(
  row: typeof agentExecutions.$inferSelect,
  idempotentReplay: boolean,
): ExecuteToolOutcome {
  if (row.status === 'completed') {
    return {
      idempotentReplay,
      executionId: row.id,
      status: 'completed',
      approvalId: null,
      result: row.output as ToolResult,
      error: null,
    };
  }

  if (row.status === 'failed') {
    const error = row.error as { code: AgentErrorCode; message: string } | null;

    return {
      idempotentReplay,
      executionId: row.id,
      status: 'failed',
      approvalId: null,
      result: null,
      error: error ?? { code: 'execution_failed', message: 'Execução anterior falhou.' },
    };
  }

  return {
    idempotentReplay,
    executionId: row.id,
    status: row.status === 'waiting_approval' ? 'waiting_approval' : 'failed',
    approvalId: null,
    result: null,
    error:
      row.status === 'waiting_approval'
        ? null
        : { code: 'execution_failed', message: `Execução em estado ${row.status}.` },
  };
}

async function failExecution(
  execution: typeof agentExecutions.$inferSelect,
  code: AgentErrorCode,
  message: string,
): Promise<ExecuteToolOutcome> {
  const [updated] = await db
    .update(agentExecutions)
    .set({
      status: 'failed',
      error: { code, message },
      finishedAt: new Date(),
    })
    .where(eq(agentExecutions.id, execution.id))
    .returning();

  await audit({
    userId: execution.userId,
    actorType: 'user',
    actorId: execution.userId ? String(execution.userId) : null,
    action: 'agent.execution.failed',
    entityType: 'agent_execution',
    entityId: String(execution.id),
    metadata: { code, message },
  });

  return {
    idempotentReplay: false,
    executionId: updated.id,
    status: 'failed',
    approvalId: null,
    result: null,
    error: { code, message },
  };
}

/**
 * Executa de fato o handler e registra o resultado. Compartilhada entre
 * a execução direta (approval_required=false) e o fluxo de aprovação
 * (approvals.ts), que chama esta mesma função após a transação de CAS
 * garantir exatamente-uma-execução.
 */
export async function runHandlerAndLog(
  execution: typeof agentExecutions.$inferSelect,
  agent: typeof agents.$inferSelect,
  tool: typeof agentTools.$inferSelect,
  input: unknown,
  userId: number,
): Promise<ExecuteToolOutcome> {
  await db
    .update(agentExecutions)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(agentExecutions.id, execution.id));

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agent.execution.started',
    entityType: 'agent_execution',
    entityId: String(execution.id),
    metadata: { toolHandler: tool.handler },
  });

  const registryTool = getTool(tool.handler);

  if (!registryTool) {
    return failExecution(execution, 'tool_not_found', 'Ferramenta inexistente ou indisponível.');
  }

  try {
    const result = await registryTool.run(input, {
      userId,
      agentId: agent.id,
      agentSlug: agent.slug,
      conversationId: execution.conversationId,
      executionId: execution.id,
      permissions: await getUserPermissionSlugs(userId),
    });

    const [updated] = await db
      .update(agentExecutions)
      .set({
        status: 'completed',
        output: result,
        finishedAt: new Date(),
      })
      .where(eq(agentExecutions.id, execution.id))
      .returning();

    await audit({
      userId,
      actorType: 'user',
      actorId: String(userId),
      action: 'agent.execution.completed',
      entityType: 'agent_execution',
      entityId: String(execution.id),
      metadata: { toolHandler: tool.handler },
    });

    return {
      idempotentReplay: false,
      executionId: updated.id,
      status: 'completed',
      approvalId: null,
      result,
      error: null,
    };
  } catch (error) {
    const agentError = error as { code?: AgentErrorCode; message?: string };
    const code: AgentErrorCode = agentError.code ?? 'execution_failed';
    const message = agentError.message ?? 'Falha ao executar a ferramenta.';

    return failExecution(execution, code, message);
  }
}
