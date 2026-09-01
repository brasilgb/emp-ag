import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentActionPlanItems, agentActionPlans } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { getTool } from '../tool-registry.js';
import type { ToolContext, ToolResult } from '../types.js';
import type { AgentErrorCode } from '../errors.js';

type ActionPlanItemRow = typeof agentActionPlanItems.$inferSelect;
type ActionPlanRow = typeof agentActionPlans.$inferSelect;

// Só estes dois execution_status disparam execução: 'pending' é o estado
// inicial de um item com decision='execute' (routes/agents/action-plans.ts
// nunca cria um item approval_required já como 'pending' — esse nasce
// 'waiting_approval' e só vira 'approved' via plan-approvals.ts). Todo o
// resto ('waiting_approval', 'blocked', 'rejected', 'skipped', 'completed',
// 'failed', 'executing') nunca é reexecutado por este loop — é assim que
// "nunca executar item blocked" e "nunca executar waiting_approval" (seção
// 7) são garantidos, sem depender de reler `decision` aqui.
const RUNNABLE_STATUSES = new Set(['pending', 'approved']);

/**
 * Executor determinístico de Action Plans (correio.md v1.2 seção 7).
 * Roda itens na ordem de dependência, nunca consulta o LLM para decidir
 * autorização — a decisão já foi tomada pelo Action Policy Evaluator e
 * persistida em `decision` no momento da criação do plano
 * (routes/agents/action-plans.ts). Idempotente: reexecutar um plano pula
 * itens já `completed`/`failed`/`blocked`/`rejected`/`skipped`.
 */
export async function executeActionPlan(planId: number, userId: number): Promise<ActionPlanRow> {
  const items = await db
    .select()
    .from(agentActionPlanItems)
    .where(eq(agentActionPlanItems.planId, planId))
    .orderBy(agentActionPlanItems.sequence);

  const byActionId = new Map(items.map((item) => [item.actionId, item]));
  const priorResults = new Map<string, ToolResult>();

  // Ordena por dependência (Kahn) — o validator já garantiu acíclico e
  // referências resolvidas antes da persistência, então este passo nunca
  // deveria detectar um ciclo em produção; se detectar (dado corrompido
  // manualmente), os itens restantes ficam pulados como 'blocked' em vez
  // de travar o processo.
  const order = topologicalOrder(items);

  for (const item of order) {
    const current = byActionId.get(item.actionId)!;

    // Idempotência: item já num estado terminal não roda de novo.
    if (!RUNNABLE_STATUSES.has(current.executionStatus)) {
      if (current.executionStatus === 'completed' && current.result) {
        priorResults.set(current.actionId, current.result as ToolResult);
      }

      continue;
    }

    const dependencyIds = ((current.dependencies as string[] | null) ?? []);
    const blockedByDependency = dependencyIds.some((depId) => {
      const dep = byActionId.get(depId);
      return !dep || dep.executionStatus !== 'completed';
    });

    if (blockedByDependency) {
      const [updated] = await db
        .update(agentActionPlanItems)
        .set({
          executionStatus: 'failed',
          error: { code: 'dependency_failed', message: 'Uma ou mais dependências não foram concluídas.' },
          executedAt: new Date(),
        })
        .where(eq(agentActionPlanItems.id, current.id))
        .returning();

      byActionId.set(current.actionId, updated);

      await audit({
        userId,
        actorType: 'user',
        actorId: String(userId),
        action: 'agent.plan.item.failed',
        entityType: 'agent_action_plan_item',
        entityId: String(current.id),
        metadata: { reason: 'dependency_failed', planId },
      });

      continue;
    }

    const outcome = await runItem(current, planId, userId, priorResults);
    byActionId.set(current.actionId, outcome);

    if (outcome.executionStatus === 'completed' && outcome.result) {
      priorResults.set(outcome.actionId, outcome.result as ToolResult);
    }
  }

  return finalizePlanStatus(planId);
}

async function runItem(
  item: ActionPlanItemRow,
  planId: number,
  userId: number,
  priorResults: Map<string, ToolResult>,
): Promise<ActionPlanItemRow> {
  const registryTool = getTool(item.tool);

  if (!registryTool) {
    return failItem(item, 'tool_not_found', 'Ferramenta inexistente ou indisponível.');
  }

  await db
    .update(agentActionPlanItems)
    .set({ executionStatus: 'executing' })
    .where(eq(agentActionPlanItems.id, item.id));

  const context: ToolContext & { priorResults: Map<string, ToolResult> } = {
    userId,
    agentId: item.agentId,
    agentSlug: item.agent,
    conversationId: null,
    executionId: item.id,
    permissions: new Set<string>(),
    priorResults,
  };

  try {
    const result = await registryTool.run(item.arguments, context);

    const [updated] = await db
      .update(agentActionPlanItems)
      .set({ executionStatus: 'completed', result, executedAt: new Date() })
      .where(eq(agentActionPlanItems.id, item.id))
      .returning();

    await audit({
      userId,
      actorType: 'user',
      actorId: String(userId),
      action: 'agent.plan.item.completed',
      entityType: 'agent_action_plan_item',
      entityId: String(item.id),
      metadata: { planId, toolHandler: item.tool },
    });

    return updated;
  } catch (error) {
    const agentError = error as { code?: AgentErrorCode; message?: string };

    return failItem(
      item,
      agentError.code ?? 'execution_failed',
      agentError.message ?? 'Falha ao executar a ferramenta.',
      planId,
      userId,
    );
  }
}

async function failItem(
  item: ActionPlanItemRow,
  code: string,
  message: string,
  planId?: number,
  userId?: number,
): Promise<ActionPlanItemRow> {
  const [updated] = await db
    .update(agentActionPlanItems)
    .set({
      executionStatus: 'failed',
      error: { code, message },
      executedAt: new Date(),
    })
    .where(eq(agentActionPlanItems.id, item.id))
    .returning();

  if (planId !== undefined && userId !== undefined) {
    await audit({
      userId,
      actorType: 'user',
      actorId: String(userId),
      action: 'agent.plan.item.failed',
      entityType: 'agent_action_plan_item',
      entityId: String(item.id),
      metadata: { code, message, planId },
    });
  }

  return updated;
}

async function finalizePlanStatus(planId: number): Promise<ActionPlanRow> {
  const items = await db
    .select()
    .from(agentActionPlanItems)
    .where(eq(agentActionPlanItems.planId, planId));

  const anyWaiting = items.some((item) => item.executionStatus === 'waiting_approval');
  const anyExecuting = items.some((item) => item.executionStatus === 'executing');
  const anyFailed = items.some((item) => item.executionStatus === 'failed');
  const anyCompleted = items.some((item) => item.executionStatus === 'completed');
  const allTerminal = items.every((item) =>
    ['completed', 'failed', 'blocked', 'rejected', 'skipped'].includes(item.executionStatus),
  );

  let status: string;

  if (anyExecuting) {
    status = 'executing';
  } else if (anyWaiting) {
    status = 'waiting_approval';
  } else if (!allTerminal) {
    status = 'executing';
  } else if (anyFailed && anyCompleted) {
    status = 'partial';
  } else if (anyFailed) {
    status = 'failed';
  } else {
    status = 'completed';
  }

  const [updated] = await db
    .update(agentActionPlans)
    .set({
      status,
      completedAt: ['completed', 'partial', 'failed', 'cancelled'].includes(status) ? new Date() : null,
    })
    .where(eq(agentActionPlans.id, planId))
    .returning();

  return updated;
}

// Kahn's algorithm — os itens já vieram validados como acíclicos por
// planner/validator.ts; qualquer item que sobrar fora da ordem (só
// possível com dado corrompido manualmente) é anexado ao final na ordem
// original, para nunca perder um item silenciosamente.
function topologicalOrder(items: ActionPlanItemRow[]): ActionPlanItemRow[] {
  const byActionId = new Map(items.map((item) => [item.actionId, item]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const item of items) {
    inDegree.set(item.actionId, 0);
  }

  for (const item of items) {
    const deps = ((item.dependencies as string[] | null) ?? []).filter((dep) => byActionId.has(dep));

    inDegree.set(item.actionId, deps.length);

    for (const dep of deps) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), item.actionId]);
    }
  }

  const queue = items.filter((item) => inDegree.get(item.actionId) === 0).map((item) => item.actionId);
  const order: ActionPlanItemRow[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const actionId = queue.shift()!;

    if (visited.has(actionId)) {
      continue;
    }

    visited.add(actionId);
    order.push(byActionId.get(actionId)!);

    for (const dependent of dependents.get(actionId) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);

      if (remaining === 0) {
        queue.push(dependent);
      }
    }
  }

  for (const item of items) {
    if (!visited.has(item.actionId)) {
      order.push(item);
    }
  }

  return order;
}
