import { and, count, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentActionPlans, agentOperationalActionProposals, agentOperationalFollowUps } from '../../db/schema/index.js';
import { AgentError } from '../errors.js';
import { audit } from '../../services/audit.js';
import { executeActionPlan } from '../executor/action-plan-executor.js';
import { planEvaluateAndPersistActionPlan } from '../orchestration/create-action-plan.js';

import { ACTION_PROPOSAL_TRANSITIONS } from './action-proposals-types.js';
import type { ActionProposalStatus } from './action-proposals-types.js';

export type ActionProposalRow = typeof agentOperationalActionProposals.$inferSelect;
type FollowUpRow = typeof agentOperationalFollowUps.$inferSelect;
type ActionPlanRow = typeof agentActionPlans.$inferSelect;

const FOLLOW_UP_TERMINAL_STATUSES = ['completed', 'dismissed'];

/**
 * Agentes v2.8 (correio.md seção 6) — criação gerencial: "apenas
 * registra FollowUp, objetivo, descrição, contexto operacional" — NUNCA
 * executa nada. Ownership (seção 4) é sempre uma cópia congelada do
 * FollowUp, nunca recalculada.
 */
export interface CreateActionProposalInput {
  title: string;
  objective: string;
  description?: string;
}

export async function createActionProposal(followUp: FollowUpRow, input: CreateActionProposalInput, createdBy: number): Promise<ActionProposalRow> {
  if (FOLLOW_UP_TERMINAL_STATUSES.includes(followUp.status)) {
    throw new AgentError('conflict', `FollowUp está "${followUp.status}" — não é possível propor uma nova ação para um FollowUp terminal.`);
  }

  const now = new Date();
  const [row] = await db
    .insert(agentOperationalActionProposals)
    .values({
      followUpId: followUp.id,
      responsibilityId: followUp.responsibilityId,
      ownerAgentId: followUp.ownerAgentId,
      title: input.title,
      objective: input.objective,
      description: input.description ?? null,
      status: 'submitted',
      createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await audit({
    userId: createdBy,
    actorType: 'user',
    actorId: String(createdBy),
    action: 'agents.operational_action.created',
    entityType: 'agent_operational_action_proposal',
    entityId: String(row!.id),
    metadata: { followUpId: followUp.id, responsibilityId: followUp.responsibilityId },
  });

  return row!;
}

export async function getActionProposalById(id: number): Promise<ActionProposalRow | null> {
  const [row] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, id)).limit(1);
  return row ?? null;
}

export interface ListActionProposalsParams {
  followUpId: number;
  page: number;
  limit: number;
}

export async function listActionProposalsForFollowUp(params: ListActionProposalsParams) {
  const where = eq(agentOperationalActionProposals.followUpId, params.followUpId);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentOperationalActionProposals)
      .where(where)
      .orderBy(desc(agentOperationalActionProposals.createdAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db.select({ total: count() }).from(agentOperationalActionProposals).where(where),
  ]);

  return { rows, total: Number(total) };
}

/**
 * Agentes v2.8 (correio.md seções 7/8/16) — ÚNICO ponto que transforma
 * uma proposta em Action Plan. Reutiliza EXATAMENTE
 * `planEvaluateAndPersistActionPlan` + `executeActionPlan` — o mesmo par
 * já usado por `POST /agents/action-plans`, `AgentJobRunner` e
 * `director/decisions/actions-service.ts:proposeActionForDecision`
 * (nunca um segundo Planner/Executor).
 *
 * Concorrência (seção 16): a "reivindicação" da submissão é um UPDATE
 * condicional atômico — `SET submittedAt=now() WHERE id=X AND
 * status='submitted'` — sem transação/lock explícito, porque uma única
 * instrução UPDATE do Postgres já é atômica por linha (MVCC): duas
 * chamadas concorrentes serializam nesse UPDATE; a perdedora reavalia o
 * WHERE contra a linha já committed pela vencedora e afeta 0 linhas —
 * exatamente o "update condicional" citado no correio.md. Só a
 * vencedora chama o pipeline oficial, garantindo NO MÁXIMO 1 Action
 * Plan por proposta mesmo sob N chamadas simultâneas.
 *
 * Fechamento v2.8 (correio.md "ponto de consistência 1") — a
 * reivindicação NÃO grava `status='planned'` (diferente da versão
 * anterior desta função). `planned` só é gravado no MESMO UPDATE que
 * grava `actionPlanId` (mais abaixo), nunca antes — garantindo o
 * invariante "planned implica Action Plan real" tanto na aplicação
 * quanto no banco (CHECK `agent_operational_action_proposals_planned_requires_plan`,
 * `schema/agent-operational-action-proposals.ts`). Todo o trecho que
 * chama o pipeline oficial está dentro de um `try/catch`: qualquer falha
 * — do Planner (`created.ok === false`) OU uma exceção inesperada em
 * `executeActionPlan`/na própria persistência — sempre resolve para
 * `failed`, nunca deixa a proposta presa em `submitted` (bloqueada para
 * sempre) nem em um estado ambíguo sem Action Plan.
 *
 * Identidade (seção 8): `requestedBy = submittedByUserId` — o ator que
 * de fato chamou este endpoint — NUNCA CEO/sistema/Supervisor/owner
 * Agent automaticamente. Mesmo padrão já usado por
 * `agents/jobs/job-runner.ts` (`requestedBy: job.createdBy`) e pela rota
 * direta `POST /agents/action-plans` (`requestedBy: userId`).
 *
 * Fechamento v2.9 (correio.md "BLOQUEIO 1") — `status='planned'` +
 * `actionPlanId` agora são gravados ANTES de `executeActionPlan` rodar
 * (não depois). Motivo: `executeActionPlan` (agents/executor/
 * action-plan-executor.ts) passou a ser o ÚNICO ponto que sincroniza a
 * Proposal a partir do Action Plan, disparando `syncActionProposalStatus`
 * internamente sempre que recalcula `agent_action_plans.status`. Para
 * esse gatilho conseguir encontrar esta proposta (a busca é por
 * `actionPlanId`), o vínculo precisa já existir quando `executeActionPlan`
 * roda — nunca mais é preciso (nem correto) chamar
 * `syncActionProposalStatus` explicitamente aqui: a chamada a
 * `executeActionPlan` abaixo já cobre isso, para submissão inicial E
 * para toda resolução de Approval futura (a mesma função é reusada por
 * `executor/plan-approvals.ts`).
 */
export async function submitActionProposal(proposal: ActionProposalRow, submittedByUserId: number): Promise<ActionProposalRow> {
  const now = new Date();

  // A guarda de corrida é `submittedAt IS NULL`, não `status='submitted'`
  // sozinho — este UPDATE não muda mais `status` (ver docblock acima:
  // `planned` só é gravado junto de `actionPlanId`), então precisa de um
  // campo que ELE PRÓPRIO grava para servir de vencedor único da
  // corrida; `submittedAt` começa nulo e é gravado exatamente uma vez.
  const [claimed] = await db
    .update(agentOperationalActionProposals)
    .set({ submittedAt: now, submittedBy: submittedByUserId, updatedAt: now })
    .where(and(eq(agentOperationalActionProposals.id, proposal.id), eq(agentOperationalActionProposals.status, 'submitted'), isNull(agentOperationalActionProposals.submittedAt)))
    .returning();

  if (!claimed) {
    throw new AgentError('conflict', `Proposta está "${proposal.status}" — só é possível submeter a partir de "submitted" (uma submissão concorrente pode já ter vencido a corrida).`);
  }

  // Fechamento v2.9 (correio.md "2. Tratar falha após a reivindicação de
  // /submit") — o `try` começa IMEDIATAMENTE após a reivindicação, e
  // inclui até o audit de "submitted": antes desta correção, esse audit
  // rodava fora do `try`, então uma falha nele (ex.: infra momentaneamente
  // indisponível) deixava a proposta reivindicada (`submittedAt` gravado)
  // porém parada em `status='submitted'` para sempre — indistinguível de
  // uma proposta nunca submetida, mas já incapaz de ser submetida de novo
  // (a guarda de corrida é `submittedAt IS NULL`). Qualquer exceção a
  // partir daqui — Planner, persistência, execução, ou o próprio audit —
  // agora resolve deterministicamente para `failed` no `catch` abaixo.
  try {
    await audit({
      userId: submittedByUserId,
      actorType: 'user',
      actorId: String(submittedByUserId),
      action: 'agents.operational_action.submitted',
      entityType: 'agent_operational_action_proposal',
      entityId: String(proposal.id),
      metadata: { followUpId: proposal.followUpId },
    });

    if (forcedSubmitFailureForTests) {
      const forced = forcedSubmitFailureForTests;
      forcedSubmitFailureForTests = null;
      throw forced;
    }

    const plannerObjective = proposal.description ? `${proposal.objective}\n\nContexto: ${proposal.description}` : proposal.objective;

    const created = await planEvaluateAndPersistActionPlan({ requestedBy: submittedByUserId, objective: plannerObjective });

    if (!created.ok) {
      return await markActionProposalFailed(claimed, created.message, submittedByUserId, created.code);
    }

    // `planned` e `actionPlanId` são gravados juntos, no mesmo UPDATE —
    // nunca um sem o outro (garantia dupla: aqui e no CHECK do banco).
    // v2.9: isso agora acontece ANTES de `executeActionPlan` (ver
    // docblock acima) — o vínculo precisa existir para o gatilho de
    // sincronização interno ao Executor conseguir encontrar esta linha.
    const [planned] = await db
      .update(agentOperationalActionProposals)
      .set({ status: 'planned', actionPlanId: created.plan.id, plannedAt: now, updatedAt: new Date() })
      .where(eq(agentOperationalActionProposals.id, proposal.id))
      .returning();

    await audit({
      userId: submittedByUserId,
      actorType: 'user',
      actorId: String(submittedByUserId),
      action: 'agents.operational_action.planned',
      entityType: 'agent_operational_action_proposal',
      entityId: String(proposal.id),
      metadata: { followUpId: proposal.followUpId, actionPlanId: created.plan.id },
    });

    // Seção 11 — o Executor não sabe (e não precisa saber) que este
    // Action Plan nasceu de um FollowUp; a origem é rastreada só do lado
    // da proposta (`actionPlanId`), nunca ao contrário. Seção 14/v2.9 —
    // `executeActionPlan` já sincroniza esta proposta internamente
    // (agents/executor/action-plan-executor.ts) assim que recalcula o
    // status do Action Plan — inclusive quando ele já chega a um estado
    // terminal dentro desta mesma chamada (ex.: nenhum item exigia
    // approval). Por isso, releio a proposta em vez de confiar no
    // retorno de `executeActionPlan` (que é o Action Plan, não a
    // Proposal) ou de chamar `syncActionProposalStatus` de novo aqui —
    // faria exatamente o mesmo trabalho que o Executor já fez.
    await executeActionPlan(created.plan.id, submittedByUserId);

    return (await getActionProposalById(proposal.id)) ?? planned!;
  } catch (error) {
    // Nem `planEvaluateAndPersistActionPlan` nem `executeActionPlan`
    // lançam `AgentError` hoje — qualquer exceção aqui (Planner,
    // persistência, execução, ou o audit de "submitted" acima) é
    // genuinamente inesperada (ex.: falha de infraestrutura). Resolve
    // sempre para `failed`, nunca deixa a proposta presa sem Action Plan.
    return await markActionProposalFailed(claimed, error instanceof Error ? error.message : 'Falha inesperada ao submeter a proposta.', submittedByUserId);
  }
}

// Fechamento v2.9 — gancho SOMENTE de teste (mesmo padrão de
// `setLLMProviderOverrideForTests` em `agents/llm/factory.ts`), nunca
// referenciado fora de `*.test.ts`: permite forçar deterministicamente
// uma exceção genuinamente inesperada logo após a reivindicação (antes do
// Planner rodar), para provar que `submitActionProposal` nunca deixa uma
// proposta reivindicada presa em `submitted` — sempre resolve para
// `failed`. `null` (default) nunca altera o comportamento em produção.
let forcedSubmitFailureForTests: Error | null = null;

export function setForcedSubmitFailureForTests(error: Error | null): void {
  forcedSubmitFailureForTests = error;
}

async function markActionProposalFailed(proposal: ActionProposalRow, reason: string, actorUserId: number, code?: string): Promise<ActionProposalRow> {
  const [failed] = await db
    .update(agentOperationalActionProposals)
    .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
    .where(eq(agentOperationalActionProposals.id, proposal.id))
    .returning();

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.operational_action.failed',
    entityType: 'agent_operational_action_proposal',
    entityId: String(proposal.id),
    metadata: { followUpId: proposal.followUpId, reason, code: code ?? null },
  });

  return failed!;
}

/**
 * Fechamento v2.8 ("ponto de consistência 2") — só cancela a partir de
 * `submitted`. Uma proposta `planned` (já com Action Plan real) nunca é
 * cancelável por aqui — a governança pertence ao Action Plan/Approval
 * existentes a partir desse ponto.
 */
export async function cancelActionProposal(proposal: ActionProposalRow, reason: string, userId: number): Promise<ActionProposalRow> {
  const currentStatus = proposal.status as ActionProposalStatus;
  if (!ACTION_PROPOSAL_TRANSITIONS[currentStatus]?.includes('cancelled')) {
    throw new AgentError(
      'conflict',
      currentStatus === 'planned'
        ? 'Proposta já foi planejada — a partir daqui, cancele ou rejeite pelo Action Plan/Approval correspondente, não pela proposta.'
        : `Proposta está "${proposal.status}" — não é possível cancelar (já em estado terminal).`,
    );
  }

  const now = new Date();

  // CAS: o WHERE reavalia `status = currentStatus` contra a linha real no
  // momento do UPDATE — protege contra uma transição concorrente (ex.:
  // `submit` vencendo a corrida e movendo para `planned`/`completed`
  // entre a leitura acima e este UPDATE).
  const [cancelled] = await db
    .update(agentOperationalActionProposals)
    .set({ status: 'cancelled', cancelledAt: now, cancelledBy: userId, failureReason: reason, updatedAt: now })
    .where(and(eq(agentOperationalActionProposals.id, proposal.id), eq(agentOperationalActionProposals.status, currentStatus)))
    .returning();

  if (!cancelled) {
    throw new AgentError('conflict', `Proposta está "${proposal.status}" — não é possível cancelar (alterada concorrentemente).`);
  }

  await audit({
    userId,
    actorType: 'user',
    actorId: String(userId),
    action: 'agents.operational_action.cancelled',
    entityType: 'agent_operational_action_proposal',
    entityId: String(proposal.id),
    metadata: { followUpId: proposal.followUpId, reason, previousStatus: proposal.status },
  });

  return cancelled;
}

const PLAN_STATUS_TO_PROPOSAL_STATUS: Record<string, 'completed' | 'failed' | null> = {
  completed: 'completed',
  // 'partial' — nem toda ação planejada foi de fato executada (itens
  // bloqueados/rejeitados/pulados) — tratado como falha do ponto de
  // vista da proposta (seção 14 só exemplifica completed/failed; esta é
  // a extensão mínima e honesta para o terceiro status terminal real do
  // Action Plan, documentada aqui em vez de deixada sem mapeamento).
  partial: 'failed',
  failed: 'failed',
  cancelled: 'failed',
};

/**
 * Agentes v2.8 (correio.md seção 14) — "quando o Action Plan chegar a
 * estado terminal, a proposta deve refletir isso". Ponto mais natural já
 * existente na arquitetura (seção 14: "usar o ponto mais natural"): o
 * MESMO ponto onde Jobs já sincronizam seu próprio status a partir do
 * Action Plan (`agents/jobs/job-runner.ts:syncJobRunStatus`) — chamado
 * logo após `executeActionPlan` tanto na submissão inicial (acima)
 * quanto na resolução tardia de uma approval
 * (`executor/plan-approvals.ts`, mesmo padrão de
 * `syncJobRunStatus` sendo chamado ali). Nunca regride uma proposta já
 * terminal (mesmo racional de nunca regredir um Run já terminal).
 *
 * NUNCA toca o FollowUp (seção 13: "não concluir automaticamente o
 * FollowUp simplesmente porque o Action Plan terminou — são conceitos
 * diferentes").
 */
export async function syncActionProposalStatus(actionPlanId: number, actorUserId?: number | null): Promise<ActionProposalRow | null> {
  const [proposal] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.actionPlanId, actionPlanId)).limit(1);
  if (!proposal) return null;

  if (proposal.status === 'completed' || proposal.status === 'failed' || proposal.status === 'cancelled') {
    return proposal;
  }

  const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, actionPlanId)).limit(1);
  if (!plan) return proposal;

  const nextStatus = PLAN_STATUS_TO_PROPOSAL_STATUS[plan.status];
  if (!nextStatus || nextStatus === proposal.status) return proposal;

  const now = new Date();
  const [updated] = await db
    .update(agentOperationalActionProposals)
    .set({
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? now : proposal.completedAt,
      failureReason: nextStatus === 'failed' ? (proposal.failureReason ?? `Action Plan terminou como "${plan.status}".`) : proposal.failureReason,
      updatedAt: now,
    })
    .where(eq(agentOperationalActionProposals.id, proposal.id))
    .returning();

  await audit({
    userId: actorUserId ?? null,
    actorType: actorUserId ? 'user' : 'system',
    actorId: actorUserId ? String(actorUserId) : null,
    action: nextStatus === 'completed' ? 'agents.operational_action.completed' : 'agents.operational_action.failed',
    entityType: 'agent_operational_action_proposal',
    entityId: String(proposal.id),
    metadata: { followUpId: proposal.followUpId, actionPlanId, planStatus: plan.status },
  });

  return updated!;
}
