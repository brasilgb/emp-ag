import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentTools, agents } from '../../db/schema/index.js';
import { getTool } from '../tool-registry.js';
import type { ActionPlanPayload, PlannedAction } from './schemas.js';
import { MAX_ACTIONS_PER_PLAN } from './schemas.js';

export interface ValidatedAction {
  action: PlannedAction;
  // Argumentos revalidados pelo Zod REAL da tool (nunca o schema
  // simplificado mostrado ao LLM — mesmo princípio de llm/interpreter.ts,
  // seção 51 da v1).
  validatedArguments: Record<string, unknown>;
  agentId: number;
  toolId: number;
}

export interface ActionPlanValidationError {
  actionId: string | null;
  code:
    | 'too_many_actions'
    | 'duplicate_action_id'
    | 'tool_not_found'
    | 'agent_not_found'
    | 'invalid_arguments'
    | 'unknown_dependency'
    | 'circular_dependency';
  message: string;
}

export type ActionPlanValidationResult =
  | { ok: true; actions: ValidatedAction[] }
  | { ok: false; errors: ActionPlanValidationError[] };

/**
 * Validação estrutural + de registry do Action Plan (correio.md seção 3).
 * Tudo-ou-nada: se qualquer ação falhar, o plano inteiro é rejeitado antes
 * de tocar o banco (nenhuma ação parcialmente aceita) — quem decide o que
 * fazer com um plano rejeitado é a camada acima (routes/agents/action-plans.ts).
 */
export async function validateActionPlan(plan: ActionPlanPayload): Promise<ActionPlanValidationResult> {
  const errors: ActionPlanValidationError[] = [];

  if (plan.actions.length > MAX_ACTIONS_PER_PLAN) {
    errors.push({
      actionId: null,
      code: 'too_many_actions',
      message: `Plano excede o máximo de ${MAX_ACTIONS_PER_PLAN} ações (recebido: ${plan.actions.length}).`,
    });
  }

  const seenIds = new Set<string>();

  for (const action of plan.actions) {
    if (seenIds.has(action.id)) {
      errors.push({
        actionId: action.id,
        code: 'duplicate_action_id',
        message: `id de ação duplicado no plano: "${action.id}".`,
      });

      continue;
    }

    seenIds.add(action.id);
  }

  // Dependências: só podem referenciar ids existentes no próprio plano.
  for (const action of plan.actions) {
    for (const dep of action.dependencies ?? []) {
      if (!seenIds.has(dep)) {
        errors.push({
          actionId: action.id,
          code: 'unknown_dependency',
          message: `Ação "${action.id}" depende de "${dep}", que não existe no plano.`,
        });
      }
    }
  }

  // Ciclos (DFS) — só roda se as dependências já forem todas conhecidas,
  // senão o grafo já está incompleto/errado e o erro acima é suficiente.
  if (errors.every((error) => error.code !== 'unknown_dependency')) {
    const cycle = findCycle(plan.actions);

    if (cycle) {
      errors.push({
        actionId: cycle,
        code: 'circular_dependency',
        message: `Dependência circular detectada envolvendo a ação "${cycle}".`,
      });
    }
  }

  const validated: ValidatedAction[] = [];

  for (const action of plan.actions) {
    const registryEntry = getTool(action.tool);

    const [dbTool] = await db
      .select()
      .from(agentTools)
      .where(and(eq(agentTools.handler, action.tool), eq(agentTools.isActive, true)))
      .limit(1);

    if (!registryEntry || !dbTool) {
      errors.push({
        actionId: action.id,
        code: 'tool_not_found',
        message: `Ferramenta inexistente ou inativa: "${action.tool}".`,
      });

      continue;
    }

    const claimedAgent = action.agent || dbTool.department;

    const [agentRow] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.slug, claimedAgent), eq(agents.isActive, true), eq(agents.status, 'active')))
      .limit(1);

    if (!agentRow) {
      errors.push({
        actionId: action.id,
        code: 'agent_not_found',
        message: `Agente inexistente ou inativo: "${claimedAgent}".`,
      });

      continue;
    }

    const parsedArguments = registryEntry.inputSchema.safeParse(action.arguments);

    if (!parsedArguments.success) {
      errors.push({
        actionId: action.id,
        code: 'invalid_arguments',
        message:
          parsedArguments.error.issues[0]?.message ??
          `Argumentos inválidos para a ferramenta "${action.tool}".`,
      });

      continue;
    }

    validated.push({
      action,
      validatedArguments: parsedArguments.data as Record<string, unknown>,
      agentId: agentRow.id,
      toolId: dbTool.id,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, actions: validated };
}

// DFS clássico com 3 cores (branco/cinza/preto) — retorna o id de uma ação
// dentro do primeiro ciclo encontrado, ou null se o grafo for acíclico.
function findCycle(actions: PlannedAction[]): string | null {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const state = new Map<string, 'visiting' | 'done'>();

  function visit(id: string): string | null {
    const current = state.get(id);

    if (current === 'done') {
      return null;
    }

    if (current === 'visiting') {
      return id;
    }

    state.set(id, 'visiting');

    const action = byId.get(id);

    for (const dep of action?.dependencies ?? []) {
      if (!byId.has(dep)) {
        continue;
      }

      const found = visit(dep);

      if (found) {
        return found;
      }
    }

    state.set(id, 'done');
    return null;
  }

  for (const action of actions) {
    const found = visit(action.id);

    if (found) {
      return found;
    }
  }

  return null;
}
