import { and, eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentActionPlanItems, agentActionPlans, agentDirectorInitiatives } from '../../../db/schema/index.js';
import { AgentError } from '../../errors.js';
import { executeActionPlan } from '../../executor/action-plan-executor.js';
import { planEvaluateAndPersistActionPlan } from '../../orchestration/create-action-plan.js';
import { audit } from '../../../services/audit.js';

import { assertInitiativeTransition } from './initiatives-lifecycle.js';
import { computeInitiativeProgress, deriveInitiativeExecutionState, type InitiativeExecutionState } from './initiatives-progress.js';
import type { InitiativeRow } from './initiatives-service.js';

export type ActionPlanRow = typeof agentActionPlans.$inferSelect;
export type ActionPlanItemRow = typeof agentActionPlanItems.$inferSelect;

export interface InitiativeExecutionView {
  actionPlanId: number | null;
  state: InitiativeExecutionState;
  progressPercent: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  blockedItems: number;
  pendingApprovalItems: number;
  /** Agentes v2.1 — saneamento seção 3: itens `skipped` (decisão `shadow`), nunca contados como `blockedItems`. */
  shadowedItems: number;
  startedAt: Date | null;
  completedAt: Date | null;
}

function buildObjectiveForInitiative(initiative: InitiativeRow): string {
  return `${initiative.title}. ${initiative.description} Racional: ${initiative.rationale}. Proponha e prepare as ações necessárias para executar esta iniciativa.`;
}

/**
 * Agentes v2.1 (correio.md seção 6/7/13) — visão operacional derivada
 * do Action Plan real, nunca de um campo de progresso solto. Sem
 * `actionPlanId`, a execução ainda nem começou.
 */
export async function getInitiativeExecutionView(initiative: InitiativeRow): Promise<InitiativeExecutionView> {
  if (!initiative.actionPlanId) {
    return {
      actionPlanId: null,
      state: 'not_started',
      progressPercent: 0,
      totalItems: 0,
      completedItems: 0,
      failedItems: 0,
      blockedItems: 0,
      pendingApprovalItems: 0,
      shadowedItems: 0,
      startedAt: null,
      completedAt: null,
    };
  }

  const [plan, items] = await Promise.all([
    db.select().from(agentActionPlans).where(eq(agentActionPlans.id, initiative.actionPlanId)).limit(1).then((rows) => rows[0]),
    db
      .select()
      .from(agentActionPlanItems)
      .where(eq(agentActionPlanItems.planId, initiative.actionPlanId))
      .orderBy(agentActionPlanItems.sequence),
  ]);

  const progress = computeInitiativeProgress(items);
  const state = deriveInitiativeExecutionState(true, progress);

  return {
    actionPlanId: initiative.actionPlanId,
    state,
    progressPercent: progress.progressPercent,
    totalItems: progress.totalItems,
    completedItems: progress.completedItems,
    failedItems: progress.failedItems,
    blockedItems: progress.blockedItems,
    pendingApprovalItems: progress.pendingApprovalItems,
    shadowedItems: progress.shadowedItems,
    startedAt: plan?.createdAt ?? null,
    completedAt: plan?.completedAt ?? null,
  };
}

/**
 * Agentes v2.1 (correio.md seção 8/9) — sincroniza `Initiative.status`
 * com a execução real. Determinístico, sem LLM, sem relógio (só reage a
 * evidência já persistida nos Action Plan Items):
 *
 * - `active` + todos os itens resolvidos com sucesso (`completed`, ou
 *   `skipped` por decisão `shadow` — seção 3 do saneamento: nunca um
 *   impedimento) → `completed` (seção 8: nunca por o LLM ter dito que
 *   terminou, nunca por tempo passado).
 * - `active` + algum item `blocked` de verdade (Policy Evaluator negou)
 *   e nada mais em andamento → `blocked` (seção 9: bloqueio estrutural
 *   real, nunca cancela sozinho). Item `skipped` NUNCA aciona isto.
 * - `blocked` + condição de bloqueio não existe mais → volta a `active`
 *   (lifecycle seção 1: `blocked → active`).
 * - `failed` NUNCA é escrito em `Initiative.status` — não existe esse
 *   estado na state machine (seção 9: falha de execução não é falha da
 *   Initiative). `executionState` derivado é que reporta `failed`.
 *
 * CAS por UPDATE condicional (`WHERE status = <esperado>`) — uma única
 * instrução SQL, nunca uma transação aberta, nunca uma chamada externa
 * envolvida — chamado de dois pontos (logo após
 * `startInitiativeExecution`, já fora de qualquer transação, e a cada
 * leitura de `GET .../execution`), seguro sob concorrência sem prender
 * conexão nenhuma.
 * `actorUserId=null` sempre — é o SISTEMA detectando evidência, nunca
 * uma decisão humana (mesmo padrão de `actorType: 'system'` já usado em
 * event-processor.ts/job-runner.ts).
 */
export async function syncInitiativeExecutionState(
  initiative: InitiativeRow,
  view: InitiativeExecutionView,
  actorUserId: number | null = null,
): Promise<InitiativeRow> {
  const now = new Date();

  if (initiative.status === 'active' && view.state === 'completed') {
    const [updated] = await db
      .update(agentDirectorInitiatives)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(and(eq(agentDirectorInitiatives.id, initiative.id), eq(agentDirectorInitiatives.status, 'active')))
      .returning();

    if (updated) {
      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.director.initiative.completed',
        entityType: 'agent_director_initiative',
        entityId: String(initiative.id),
        metadata: { goalId: initiative.goalId, actionPlanId: initiative.actionPlanId, auto: true, shadowedItems: view.shadowedItems },
      });
      return updated;
    }
  }

  if (initiative.status === 'active' && view.state === 'blocked') {
    const [updated] = await db
      .update(agentDirectorInitiatives)
      .set({ status: 'blocked', updatedAt: now })
      .where(and(eq(agentDirectorInitiatives.id, initiative.id), eq(agentDirectorInitiatives.status, 'active')))
      .returning();

    if (updated) {
      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.director.initiative.blocked',
        entityType: 'agent_director_initiative',
        entityId: String(initiative.id),
        metadata: { goalId: initiative.goalId, actionPlanId: initiative.actionPlanId, blockedItems: view.blockedItems, auto: true },
      });
      return updated;
    }
  }

  if (initiative.status === 'blocked' && view.state !== 'blocked' && view.state !== 'not_started') {
    const [updated] = await db
      .update(agentDirectorInitiatives)
      .set({ status: 'active', updatedAt: now })
      .where(and(eq(agentDirectorInitiatives.id, initiative.id), eq(agentDirectorInitiatives.status, 'blocked')))
      .returning();

    if (updated) {
      await audit({
        userId: actorUserId,
        actorType: actorUserId ? 'user' : 'system',
        actorId: actorUserId ? String(actorUserId) : null,
        action: 'agents.director.initiative.resumed',
        entityType: 'agent_director_initiative',
        entityId: String(initiative.id),
        metadata: { goalId: initiative.goalId, actionPlanId: initiative.actionPlanId, auto: true },
      });
      return updated;
    }
  }

  return initiative;
}

/**
 * Agentes v2.1 — saneamento seção 2: conclusão manual só é permitida
 * quando a MESMA evidência determinística da conclusão automática já
 * está presente (`executionState === 'completed'`) — nunca antes disso.
 * "Para esta v2.1, preferir não criar conceito novo": não existe uma
 * segunda semântica de "conclusão humana independente da execução". O
 * botão/endpoint manual serve para um propósito real e não-redundante:
 * forçar a sincronização IMEDIATAMENTE (em vez de esperar a próxima
 * leitura de `GET .../execution`) — nunca para declarar concluído algo
 * que objetivamente ainda não terminou.
 */
export async function completeInitiativeManually(initiative: InitiativeRow, actorUserId: number): Promise<InitiativeRow> {
  assertInitiativeTransition(initiative.status, 'completed');

  const view = await getInitiativeExecutionView(initiative);
  if (view.state !== 'completed') {
    throw new AgentError(
      'conflict',
      `A execução ainda não terminou (estado atual: "${view.state}", ${view.completedItems}/${view.totalItems} ações concluídas) — só é possível concluir quando toda a execução tiver sucesso.`,
    );
  }

  return syncInitiativeExecutionState(initiative, view, actorUserId);
}

export interface StartInitiativeExecutionResult {
  initiative: InitiativeRow;
  plan: ActionPlanRow;
  items: ActionPlanItemRow[];
  /** false quando a chamada foi idempotente (Initiative já estava `active`) — seção 3. */
  created: boolean;
}

const CLAIM_POLL_INTERVAL_MS = 100;
// Generoso o bastante para cobrir AGENT_LLM_TIMEOUT_MS (5s por padrão,
// config/env.ts) + tempo real de execução do Action Plan + margem —
// nunca indefinido (seção 1: "não deixe Initiative eternamente em
// estado intermediário").
const CLAIM_POLL_MAX_WAIT_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Agentes v2.1 — saneamento seção 1: espera (POLLING curto, fora de
 * qualquer transação/lock) o vencedor da corrida de claim terminar de
 * vincular o Action Plan. Nunca um `SELECT ... FOR UPDATE` bloqueante —
 * só leituras simples e repetidas, baratas, sem segurar nenhum recurso
 * do Postgres. Se o vencedor reverteu (voltou para `approved`
 * porque a criação do plano falhou), quem está esperando não fica preso
 * — recebe um erro claro e pode chamar `startInitiativeExecution` de
 * novo.
 */
async function waitForClaimWinner(initiativeId: number): Promise<InitiativeRow> {
  const deadline = Date.now() + CLAIM_POLL_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    const [row] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiativeId)).limit(1);
    if (!row) throw new AgentError('validation_error', 'Initiative não encontrada.');

    if (row.status === 'active' && row.actionPlanId) return row;

    if (row.status === 'approved') {
      // O vencedor da corrida reverteu o claim (planejamento falhou) —
      // nunca deixa quem está esperando preso indefinidamente.
      throw new AgentError('conflict', 'A tentativa concorrente de iniciar esta Initiative falhou — tente novamente.');
    }

    await sleep(CLAIM_POLL_INTERVAL_MS);
  }

  throw new AgentError('conflict', 'Tempo esgotado aguardando o início concorrente desta Initiative — tente novamente.');
}

/**
 * Agentes v2.1 (correio.md seção 2/3/5) — único ponto de entrada para
 * transformar uma Initiative `approved` em execução real. Reutiliza
 * EXATAMENTE o pipeline oficial (`planEvaluateAndPersistActionPlan` +
 * `executeActionPlan`, as mesmas duas funções de `POST
 * /agents/action-plans` v1.2 / `.../decisions/:id/propose` v1.9 /
 * `.../initiatives/:id/propose` v2.0 — nenhum executor novo). Identidade
 * do usuário preservada: `requestedBy: userId` é quem chamou este
 * método, nunca "system"/"director" (seção 5).
 *
 * Concorrência (correio.md — saneamento seção 1): claim CURTO e
 * atômico, nunca uma transação/lock durante o Planner/LLM/Executor.
 *
 * ```text
 * transação curta:
 *     SELECT ... FOR UPDATE da Initiative
 *     valida status === 'approved'
 *     UPDATE status='active' (adquire o direito exclusivo de iniciar)
 * commit  ← lock liberado AQUI, antes de qualquer chamada externa
 *
 * fora de transação:
 *     planEvaluateAndPersistActionPlan() / executeActionPlan()
 *
 * transação curta:
 *     UPDATE actionPlanId  (vincula o resultado)
 * commit
 * ```
 *
 * Quem perde a corrida do claim (a `UPDATE ... WHERE status='approved'`
 * não afeta nenhuma linha, porque outra chamada já venceu) espera o
 * vencedor terminar via `waitForClaimWinner` — polling curto e sem
 * lock, nunca um `SELECT ... FOR UPDATE` bloqueante. Falha na criação
 * do plano reverte o claim (`status` volta a `approved`) numa transação
 * curta própria — nunca deixa a Initiative presa em `active` sem plano.
 *
 * (Uma primeira versão desta função segurava UMA ÚNICA transação com o
 * lock de linha da Initiative do claim até o vínculo final do Action
 * Plan — incluindo durante a chamada ao Planner/LLM. Resolvia a
 * concorrência corretamente, mas prendia uma conexão do pool por
 * segundos a cada início de execução, o que é inaceitável em produção
 * sob carga — corrigido nesta versão para o padrão claim-curto +
 * trabalho-fora-de-transação + vínculo-curto acima.)
 */
export async function startInitiativeExecution(initiative: InitiativeRow, userId: number): Promise<StartInitiativeExecutionResult> {
  if (initiative.status === 'active') {
    if (!initiative.actionPlanId) {
      // Outra chamada está no meio do claim (já marcou active, ainda
      // não vinculou o plano) — espera, nunca erra sem necessidade.
      const resolved = await waitForClaimWinner(initiative.id);
      return { ...(await loadPlanAndItems(resolved.actionPlanId!)), initiative: resolved, created: false };
    }
    return { ...(await loadPlanAndItems(initiative.actionPlanId)), initiative, created: false };
  }

  if (initiative.status !== 'approved') {
    // "Iniciar execução" é mais estreito que a tabela geral de
    // lifecycle (que também permite `blocked → active`, mas só pelo
    // caminho AUTOMÁTICO de `syncInitiativeExecutionState` quando o
    // bloqueio deixa de existir — nunca por uma chamada manual de
    // start).
    throw new AgentError(
      'conflict',
      `Initiative está "${initiative.status}" — só é possível iniciar execução a partir de "approved" (ou repetir a chamada quando já "active", que é idempotente).`,
    );
  }

  // --- transação curta 1: claim ---
  const now = new Date();
  const claimed = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id)).for('update');
    if (!locked) throw new AgentError('validation_error', 'Initiative não encontrada.');

    if (locked.status !== 'approved') {
      // Outra chamada já venceu a corrida entre a leitura de fora e o
      // lock daqui — devolve null, tratado fora da transação.
      return null;
    }

    const [row] = await tx
      .update(agentDirectorInitiatives)
      .set({ status: 'active', startedAt: locked.startedAt ?? now, updatedAt: now })
      .where(eq(agentDirectorInitiatives.id, locked.id))
      .returning();

    return row!;
  });
  // Transação já commitada — lock de linha liberado aqui, ANTES de
  // qualquer chamada ao Planner/LLM/Executor.

  if (!claimed) {
    const resolved = await waitForClaimWinner(initiative.id);
    return { ...(await loadPlanAndItems(resolved.actionPlanId!)), initiative: resolved, created: false };
  }

  // --- fora de transação: Planner / Policy Evaluator / Executor ---
  try {
    const objective = buildObjectiveForInitiative(claimed);
    const created = await planEvaluateAndPersistActionPlan({ requestedBy: userId, objective });

    if (!created.ok) {
      throw new AgentError(created.code, created.message, 'details' in created ? created.details : undefined);
    }

    const finalPlan = await executeActionPlan(created.plan.id, userId);
    const finalItems = await db
      .select()
      .from(agentActionPlanItems)
      .where(eq(agentActionPlanItems.planId, created.plan.id))
      .orderBy(agentActionPlanItems.sequence);

    // --- transação curta 2: vincula o resultado ---
    const [updatedInitiative] = await db
      .update(agentDirectorInitiatives)
      .set({ actionPlanId: finalPlan.id, updatedAt: new Date() })
      .where(eq(agentDirectorInitiatives.id, claimed.id))
      .returning();

    await audit({
      userId,
      actorType: 'user',
      actorId: String(userId),
      action: 'agents.director.initiative.action_proposed',
      entityType: 'agent_director_initiative',
      entityId: String(claimed.id),
      metadata: { goalId: claimed.goalId, resultingActionPlanId: finalPlan.id },
    });

    // Conclusão automática imediata (seção 8) se o plano já resolveu
    // sincronamente (ex.: todas as ações eram `execute`, sem approval).
    const view = await getInitiativeExecutionView(updatedInitiative!);
    const synced = await syncInitiativeExecutionState(updatedInitiative!, view, null);

    return { initiative: synced, plan: finalPlan, items: finalItems, created: true };
  } catch (error) {
    // Reverte o claim (transação curta própria) — nunca deixa a
    // Initiative travada em `active` sem Action Plan de verdade.
    await db
      .update(agentDirectorInitiatives)
      .set({ status: 'approved', startedAt: null, updatedAt: new Date() })
      .where(eq(agentDirectorInitiatives.id, claimed.id));
    throw error;
  }
}

async function loadPlanAndItems(actionPlanId: number): Promise<{ plan: ActionPlanRow; items: ActionPlanItemRow[] }> {
  const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, actionPlanId)).limit(1);
  if (!plan) throw new AgentError('conflict', 'Action Plan vinculado à Initiative não foi encontrado.');

  const items = await db
    .select()
    .from(agentActionPlanItems)
    .where(eq(agentActionPlanItems.planId, actionPlanId))
    .orderBy(agentActionPlanItems.sequence);

  return { plan, items };
}
