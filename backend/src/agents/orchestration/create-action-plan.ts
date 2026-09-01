import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
  agentToolPermissions,
  agentTools,
} from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { audit } from '../../services/audit.js';
import { getLLMProvider } from '../llm/factory.js';
import { getTool } from '../tool-registry.js';
import { getUserPermissionSlugs } from '../security/permissions.js';
import type { AutonomyLevel } from '../types.js';
import { planActions } from '../planner/action-planner.js';
import { validateActionPlan } from '../planner/validator.js';
import type { ActionPlanValidationError } from '../planner/validator.js';
import { MAX_ACTIONS_PER_PLAN } from '../planner/schemas.js';
import { evaluateAction } from '../policy/action-policy-evaluator.js';

const APPROVAL_EXPIRES_MS = 24 * 60 * 60 * 1000;

export type CreateActionPlanFailureCode =
  | 'llm_unavailable'
  | 'planning_failed'
  | 'plan_too_large'
  | 'validation_error';

export type CreateActionPlanResult =
  | {
      ok: true;
      plan: typeof agentActionPlans.$inferSelect;
      items: (typeof agentActionPlanItems.$inferSelect)[];
    }
  | {
      ok: false;
      code: CreateActionPlanFailureCode;
      message: string;
      details?: ActionPlanValidationError[];
    };

export interface CreateActionPlanParams {
  requestedBy: number;
  objective: string;
  // Agentes v1.3 (correio.md seção 6): quando o plano nasce de um Job Run,
  // vincula agent_action_plans.job_run_id — nullable, nunca obrigatório
  // (execução manual de Action Plan via /agents/action-plans continua
  // funcionando sem Job, seção 6 do correio.md v1.3).
  jobRunId?: number | null;
  // Agentes v1.3 seção 8 (max_actions_per_run): teto adicional, aplicado
  // ANTES da persistência — nunca trunca o plano silenciosamente, apenas
  // rejeita inteiro com 'plan_too_large' ("não tentar contornar limite
  // automaticamente"). Default = teto global do validator (mesmo limite
  // que já vale para POST /agents/action-plans na v1.2, comportamento
  // idêntico quando este parâmetro não é passado).
  maxActions?: number;
  // Agentes v1.3 (correio.md seção 13) — Shadow Mode por Job, além do
  // flag global env.AGENT_LLM_SHADOW_MODE (v1.1/v1.2, inalterado). Os
  // dois se somam (OR): shadow global ativo OU job.shadowMode=true já
  // basta para nenhuma ação mutável executar — mesma checagem do Action
  // Policy Evaluator (agents/policy/action-policy-evaluator.ts), nunca
  // uma segunda implementação paralela.
  shadowMode?: boolean;
}

/**
 * Núcleo único de "objetivo → Action Plan avaliado e persistido"
 * (correio.md v1.3 seção 0 do plano de implementação — extraído de
 * routes/agents/action-plans.ts v1.2 para ser reaproveitado, sem
 * duplicação, tanto pela rota direta quanto por agents/jobs/job-runner.ts.
 * NUNCA executa as ações (isso continua sendo executeActionPlan, chamado
 * por quem chama esta função) — só planeja, valida e persiste plano +
 * itens + approvals, exatamente como o POST /agents/action-plans da v1.2
 * fazia inline.
 */
export async function planEvaluateAndPersistActionPlan(
  params: CreateActionPlanParams,
): Promise<CreateActionPlanResult> {
  if (!env.AGENT_LLM_ENABLED) {
    return {
      ok: false,
      code: 'llm_unavailable',
      message: 'Planejamento de ações requer o LLM habilitado (AGENT_LLM_ENABLED=false).',
    };
  }

  const planned = await planActions({
    provider: getLLMProvider(),
    model: env.AGENT_LLM_MODEL,
    objective: params.objective,
    timeoutMs: env.AGENT_LLM_TIMEOUT_MS,
  });

  if (planned.status === 'timeout' || planned.status === 'provider_error' || planned.status === 'invalid_output') {
    return {
      ok: false,
      code: 'planning_failed',
      message: planned.errorMessage ?? 'Não foi possível gerar um plano de ações a partir deste objetivo.',
    };
  }

  if (!planned.plan) {
    return { ok: false, code: 'planning_failed', message: 'O modelo não retornou um plano.' };
  }

  const maxActions = params.maxActions ?? MAX_ACTIONS_PER_PLAN;

  if (planned.plan.actions.length > maxActions) {
    return {
      ok: false,
      code: 'plan_too_large',
      message: `Plano excede o máximo de ${maxActions} ações permitido (recebido: ${planned.plan.actions.length}).`,
    };
  }

  // 'empty' (actions: []) é um plano legítimo — o objetivo não mapeia para
  // nenhuma ferramenta disponível. Segue para persistência com zero itens
  // em vez de erro, mesmo racional do fallback v1.1 quando nenhuma tool é
  // reconhecida.
  const validation = await validateActionPlan(planned.plan);

  if (!validation.ok) {
    return {
      ok: false,
      code: 'validation_error',
      message: 'Action Plan gerado é inválido.',
      details: validation.errors,
    };
  }

  const [planRow] = await db
    .insert(agentActionPlans)
    .values({
      requestedBy: params.requestedBy,
      objective: planned.plan.objective,
      summary: planned.plan.summary,
      status: 'evaluating',
      llmProvider: planned.provider,
      llmModel: planned.model,
      jobRunId: params.jobRunId ?? null,
    })
    .returning();

  await audit({
    userId: params.requestedBy,
    actorType: 'user',
    actorId: String(params.requestedBy),
    action: 'agent.plan.created',
    entityType: 'agent_action_plan',
    entityId: String(planRow.id),
    metadata: { objective: planned.plan.objective, actionCount: validation.actions.length, jobRunId: params.jobRunId ?? null },
  });

  const toolIds = [...new Set(validation.actions.map((entry) => entry.toolId))];

  const toolRows = toolIds.length > 0 ? await db.select().from(agentTools).where(inArray(agentTools.id, toolIds)) : [];
  const toolById = new Map(toolRows.map((row) => [row.id, row]));

  const overrideRows =
    toolIds.length > 0
      ? await db.select().from(agentToolPermissions).where(inArray(agentToolPermissions.toolId, toolIds))
      : [];
  const overrideByPair = new Map(overrideRows.map((row) => [`${row.agentId}:${row.toolId}`, row.requiresApprovalOverride]));

  const userPermissions = await getUserPermissionSlugs(params.requestedBy);
  const shadowModeActive = env.AGENT_LLM_SHADOW_MODE || (params.shadowMode ?? false);

  let sequence = 0;

  for (const entry of validation.actions) {
    const dbTool = toolById.get(entry.toolId);
    const registryTool = getTool(entry.action.tool);

    if (!dbTool || !registryTool) {
      // Não deveria acontecer (validator já checou) — defesa em
      // profundidade contra corrida entre validação e persistência.
      continue;
    }

    const requiresApprovalOverride = overrideByPair.get(`${entry.agentId}:${entry.toolId}`) ?? false;

    const decision = evaluateAction({
      tool: {
        requiredPermission: registryTool.requiredPermission,
        autonomyLevel: dbTool.autonomyLevel as AutonomyLevel,
        isSensitive: dbTool.isSensitive,
        risk: dbTool.risk as 'read' | 'low' | 'medium' | 'high',
        mutatesData: dbTool.mutatesData,
        requiresApproval: dbTool.requiresApproval,
      },
      userPermissions,
      requiresApprovalOverride,
      shadowModeActive,
      confidence: entry.action.confidence,
    });

    const initialStatus =
      decision.decision === 'execute'
        ? 'pending'
        : decision.decision === 'approval_required'
          ? 'waiting_approval'
          : decision.decision === 'blocked'
            ? 'blocked'
            : 'skipped';

    const [item] = await db
      .insert(agentActionPlanItems)
      .values({
        planId: planRow.id,
        sequence: sequence++,
        actionId: entry.action.id,
        agent: entry.action.agent,
        agentId: entry.agentId,
        tool: entry.action.tool,
        toolId: entry.toolId,
        arguments: entry.validatedArguments,
        dependencies: entry.action.dependencies ?? [],
        reason: entry.action.reason,
        confidence: entry.action.confidence.toFixed(3),
        risk: dbTool.risk,
        decision: decision.decision,
        decisionReason: 'reason' in decision ? decision.reason : null,
        executionStatus: initialStatus,
      })
      .returning();

    await audit({
      userId: params.requestedBy,
      actorType: 'user',
      actorId: String(params.requestedBy),
      action: 'agent.plan.item.policy_decided',
      entityType: 'agent_action_plan_item',
      entityId: String(item.id),
      metadata: { planId: planRow.id, decision: decision.decision, toolHandler: entry.action.tool },
    });

    if (decision.decision === 'approval_required') {
      const [approval] = await db
        .insert(agentApprovals)
        .values({
          planItemId: item.id,
          requestedForUserId: params.requestedBy,
          status: 'pending',
          reason: decision.reason,
          requestPayload: { tool: entry.action.tool, arguments: entry.validatedArguments },
          expiresAt: new Date(Date.now() + APPROVAL_EXPIRES_MS),
        })
        .returning();

      await audit({
        userId: params.requestedBy,
        actorType: 'user',
        actorId: String(params.requestedBy),
        action: 'agent.plan.approval.requested',
        entityType: 'agent_approval',
        entityId: String(approval.id),
        metadata: { planItemId: item.id, planId: planRow.id },
      });
    }
  }

  const items = await db
    .select()
    .from(agentActionPlanItems)
    .where(eq(agentActionPlanItems.planId, planRow.id))
    .orderBy(agentActionPlanItems.sequence);

  return { ok: true, plan: planRow, items };
}
