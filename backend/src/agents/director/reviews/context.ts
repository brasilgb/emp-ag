import type { agentActionPlanItems, agentActionPlans, agentDirectorGoals } from '../../../db/schema/index.js';
import type { InitiativeExecutionView } from '../goals/initiatives-execution-service.js';
import type { InitiativeRow } from '../goals/initiatives-service.js';

export type GoalRow = typeof agentDirectorGoals.$inferSelect;
export type ActionPlanRow = typeof agentActionPlans.$inferSelect;
export type ActionPlanItemRow = typeof agentActionPlanItems.$inferSelect;

/**
 * Agentes v2.2 (correio.md seção 5/6) — DTO limitado e determinístico
 * montado pelo BACKEND antes de qualquer chamada ao provider LLM. Nunca
 * SQL, nunca acesso a tabela, nunca credencial — só os campos já
 * autorizados/necessários listados abaixo, o MESMO objeto que acaba
 * persistido em `agent_executive_reviews.evidence` (seção 5: "o Diretor
 * não deve simplesmente afirmar que algo funcionou" — evidência sempre
 * rastreável). `items[].result`/`items[].error` já são o retorno real de
 * `executeActionPlan()` (agents/executor/action-plan-executor.ts) — nunca
 * reinterpretados, apenas repassados.
 */
export interface ExecutiveReviewContextItem {
  actionId: string;
  agent: string;
  tool: string;
  reason: string | null;
  decision: string;
  executionStatus: string;
  result: unknown;
  error: unknown;
}

export interface ExecutiveReviewContext {
  goal: {
    id: number;
    title: string;
    description: string;
    domain: string;
    status: string;
    health: string;
    progressPercent: number;
    targetType: string;
    targetValue: string | null;
    currentValue: string | null;
    unit: string | null;
  };
  initiative: {
    id: number;
    title: string;
    description: string;
    rationale: string;
    expectedImpact: string | null;
    status: string;
    priority: string;
  };
  execution: {
    state: InitiativeExecutionView['state'];
    progressPercent: number;
    totalItems: number;
    completedItems: number;
    failedItems: number;
    blockedItems: number;
    pendingApprovalItems: number;
    shadowedItems: number;
    startedAt: string | null;
    completedAt: string | null;
  };
  actionPlan: {
    id: number;
    objective: string;
    summary: string;
    status: string;
  };
  items: ExecutiveReviewContextItem[];
}

function summarizeExpectedResult(goal: GoalRow, initiative: InitiativeRow): string {
  const targetText =
    goal.targetType === 'metric'
      ? `meta métrica de ${goal.targetValue ?? '?'}${goal.unit ? ` ${goal.unit}` : ''} (atual: ${goal.currentValue ?? '0'})`
      : 'meta de marco (milestone)';

  return `A Initiative "${initiative.title}" foi criada para contribuir com o Goal "${goal.title}" (domínio ${goal.domain}, ${targetText}). Racional original: ${initiative.rationale}`;
}

function summarizeActualResult(view: InitiativeExecutionView): string {
  return (
    `Execução técnica finalizada com estado "${view.state}": ` +
    `${view.completedItems}/${view.totalItems} ações concluídas, ` +
    `${view.shadowedItems} não executadas por decisão de shadow/baixa confiança, ` +
    `${view.blockedItems} bloqueadas por policy, ` +
    `${view.failedItems} com falha de execução, ` +
    `${view.pendingApprovalItems} ainda aguardando aprovação humana.`
  );
}

export function buildExecutiveReviewContext(params: {
  goal: GoalRow;
  initiative: InitiativeRow;
  plan: ActionPlanRow;
  items: ActionPlanItemRow[];
  view: InitiativeExecutionView;
}): { context: ExecutiveReviewContext; expectedResult: string; actualResult: string } {
  const { goal, initiative, plan, items, view } = params;

  const context: ExecutiveReviewContext = {
    goal: {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      domain: goal.domain,
      status: goal.status,
      health: goal.health,
      progressPercent: goal.progressPercent,
      targetType: goal.targetType,
      targetValue: goal.targetValue,
      currentValue: goal.currentValue,
      unit: goal.unit,
    },
    initiative: {
      id: initiative.id,
      title: initiative.title,
      description: initiative.description,
      rationale: initiative.rationale,
      expectedImpact: initiative.expectedImpact,
      status: initiative.status,
      priority: initiative.priority,
    },
    execution: {
      state: view.state,
      progressPercent: view.progressPercent,
      totalItems: view.totalItems,
      completedItems: view.completedItems,
      failedItems: view.failedItems,
      blockedItems: view.blockedItems,
      pendingApprovalItems: view.pendingApprovalItems,
      shadowedItems: view.shadowedItems,
      startedAt: view.startedAt ? view.startedAt.toISOString() : null,
      completedAt: view.completedAt ? view.completedAt.toISOString() : null,
    },
    actionPlan: {
      id: plan.id,
      objective: plan.objective,
      summary: plan.summary,
      status: plan.status,
    },
    items: items.map((item) => ({
      actionId: item.actionId,
      agent: item.agent,
      tool: item.tool,
      reason: item.reason,
      decision: item.decision,
      executionStatus: item.executionStatus,
      result: item.result,
      error: item.error,
    })),
  };

  return {
    context,
    expectedResult: summarizeExpectedResult(goal, initiative),
    actualResult: summarizeActualResult(view),
  };
}
