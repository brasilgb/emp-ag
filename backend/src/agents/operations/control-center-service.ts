import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
  agentOperationalActionProposals,
  agentOperationalEscalations,
  agentOperationalFollowUps,
  agentResponsibilities,
  auditLogs,
} from '../../db/schema/index.js';
import { getUserPermissionSlugs } from '../security/permissions.js';

import { getApprovalsSummary, getRunsSummary } from '../../routes/agents/operations.js';

/*
 * Agentes v3.0 (correio.md "Etapa 1/2") — Operational Control Center.
 *
 * Revisão arquitetural feita antes deste arquivo (registrada em
 * executed.md): TODA métrica aqui é uma consulta SQL sobre tabelas já
 * existentes (`agent_responsibilities`, `agent_operational_escalations`,
 * `agent_operational_follow_ups`, `agent_operational_action_proposals`,
 * `agent_action_plans`, `agent_action_plan_items`, `agent_approvals`,
 * `agent_job_runs` via `getRunsSummary` já existente) — nenhuma tabela
 * nova, nenhum campo novo, nenhum número persistido (princípio 7 do
 * correio.md). `getApprovalsSummary`/`getRunsSummary` são REUTILIZADAS de
 * `routes/agents/operations.ts` (v1.6/v1.8) — nunca reimplementadas.
 */

const TERMINAL_FOLLOW_UP_STATUSES = ['completed', 'dismissed'];
const RESOLVED_RECENTLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface ControlCenterOverview {
  responsibilitiesActive: number;
  escalationsOpen: number;
  escalationsWithoutFollowUp: number;
  followUpsOpen: number;
  followUpsOverdue: number;
  proposalsSubmitted: number;
  proposalsPlanned: number;
  proposalsFailed: number;
  actionPlansWaitingApproval: number;
  actionPlansPartial: number;
  actionPlansFailed: number;
  approvalsPending: number;
  jobRunsFailedRecent: number;
}

/**
 * Todos os contadores abaixo são um único `count(*) filter` por tabela
 * (mesmo padrão de `getJobsSummary`/`getApprovalsSummary` em
 * `routes/agents/operations.ts`) — nunca carrega as linhas no Node só
 * para contar.
 */
export async function getControlCenterOverview(): Promise<ControlCenterOverview> {
  const now = new Date();
  const from = new Date(now.getTime() - RESOLVED_RECENTLY_WINDOW_MS);

  const [
    [responsibilitiesRow],
    [escalationsRow],
    [followUpsRow],
    [proposalsRow],
    [actionPlansRow],
    escalationsWithoutFollowUp,
    approvals,
    runs,
  ] = await Promise.all([
    db
      .select({ active: sql<number>`count(*) filter (where ${agentResponsibilities.enabled} = true)` })
      .from(agentResponsibilities),
    db
      .select({ open: sql<number>`count(*) filter (where ${agentOperationalEscalations.status} = 'open')` })
      .from(agentOperationalEscalations),
    db
      .select({
        open: sql<number>`count(*) filter (where ${agentOperationalFollowUps.status} not in ('completed', 'dismissed'))`,
        overdue: sql<number>`count(*) filter (where ${agentOperationalFollowUps.status} not in ('completed', 'dismissed') and ${agentOperationalFollowUps.dueAt} is not null and ${agentOperationalFollowUps.dueAt} < now())`,
      })
      .from(agentOperationalFollowUps),
    db
      .select({
        submitted: sql<number>`count(*) filter (where ${agentOperationalActionProposals.status} = 'submitted')`,
        planned: sql<number>`count(*) filter (where ${agentOperationalActionProposals.status} = 'planned')`,
        failed: sql<number>`count(*) filter (where ${agentOperationalActionProposals.status} = 'failed')`,
      })
      .from(agentOperationalActionProposals),
    db
      .select({
        waitingApproval: sql<number>`count(*) filter (where ${agentActionPlans.status} = 'waiting_approval')`,
        partial: sql<number>`count(*) filter (where ${agentActionPlans.status} = 'partial')`,
        failed: sql<number>`count(*) filter (where ${agentActionPlans.status} = 'failed')`,
      })
      .from(agentActionPlans),
    // "Escalation sem FollowUp quando deveria possuir um" (Etapa 5) — só
    // conta escalations abertas (as já resolvidas/dismissed nunca
    // precisariam de um FollowUp criado retroativamente) sem NENHUM
    // FollowUp apontando para elas via `escalationId` (FK real, seção 6
    // dos "Princípios bloqueantes" da v2.8 — nunca um texto solto).
    db
      .select({ count: sql<number>`count(*)` })
      .from(agentOperationalEscalations)
      .where(
        and(
          eq(agentOperationalEscalations.status, 'open'),
          sql`not exists (select 1 from agent_operational_follow_ups f where f.escalation_id = ${agentOperationalEscalations.id})`,
        ),
      ),
    getApprovalsSummary(),
    getRunsSummary(from, now),
  ]);

  return {
    responsibilitiesActive: Number(responsibilitiesRow.active),
    escalationsOpen: Number(escalationsRow.open),
    escalationsWithoutFollowUp: Number(escalationsWithoutFollowUp[0]?.count ?? 0),
    followUpsOpen: Number(followUpsRow.open),
    followUpsOverdue: Number(followUpsRow.overdue),
    proposalsSubmitted: Number(proposalsRow.submitted),
    proposalsPlanned: Number(proposalsRow.planned),
    proposalsFailed: Number(proposalsRow.failed),
    actionPlansWaitingApproval: Number(actionPlansRow.waitingApproval),
    actionPlansPartial: Number(actionPlansRow.partial),
    actionPlansFailed: Number(actionPlansRow.failed),
    approvalsPending: approvals.pending,
    jobRunsFailedRecent: runs.failed,
  };
}

export type OperationalQueueName = 'needs_attention_now' | 'awaiting_human' | 'failed' | 'in_progress' | 'resolved_recently';

export interface OperationalQueueItem {
  followUpId: number;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  updatedAt: string;
  responsibilityId: number;
  escalationId: number | null;
  ownerAgentId: number;
  latestProposalId: number | null;
  latestProposalStatus: string | null;
  actionPlanId: number | null;
  hasPendingApproval: boolean;
  queue: OperationalQueueName;
  reason: string;
}

/**
 * Agentes v3.0 (correio.md "Etapa 2 — Filas operacionais") — critérios
 * DETERMINÍSTICOS e documentados aqui (nunca "prioridade de IA", seção
 * bloqueante): cada FollowUp cai em EXATAMENTE uma fila, avaliada nesta
 * ordem de prioridade (a primeira condição que bater decide a fila):
 *
 * 1. `needs_attention_now` — vencido (`dueAt` no passado) OU prioridade
 *    `critical`. O caso mais urgente sempre aparece aqui, independente
 *    de estar aguardando aprovação ou não.
 * 2. `failed` — a Proposal mais recente deste FollowUp terminou `failed`
 *    (e o FollowUp não está vencido/crítico — já teria caído acima).
 * 3. `awaiting_human` — precisa de uma ação humana explícita agora: uma
 *    Approval pendente no Action Plan da Proposal mais recente, OU a
 *    Proposal mais recente está `submitted` (criada mas ainda não
 *    submetida ao pipeline oficial), OU o FollowUp está `open` (criado
 *    mas ninguém ainda iniciou o acompanhamento).
 * 4. `in_progress` — `in_progress` ou `waiting`, sem nenhum dos sinais
 *    acima (está andando normalmente).
 * 5. `resolved_recently` — `completed`/`dismissed` nos últimos 7 dias
 *    (mesma janela default de `/operations/summary`, v1.6).
 *
 * Cada FollowUp entra em NO MÁXIMO uma fila (nunca duplicado entre
 * filas) — resultado de avaliar as condições em ordem e parar na
 * primeira que bater.
 */
export async function getOperationalQueues(limit = 50): Promise<Record<OperationalQueueName, OperationalQueueItem[]>> {
  const now = new Date();
  const resolvedSince = new Date(now.getTime() - RESOLVED_RECENTLY_WINDOW_MS);

  const [openFollowUps, resolvedFollowUps] = await Promise.all([
    db
      .select()
      .from(agentOperationalFollowUps)
      .where(sql`${agentOperationalFollowUps.status} not in ('completed', 'dismissed')`)
      .orderBy(desc(agentOperationalFollowUps.updatedAt))
      .limit(500),
    db
      .select()
      .from(agentOperationalFollowUps)
      .where(
        and(
          sql`${agentOperationalFollowUps.status} in ('completed', 'dismissed')`,
          sql`coalesce(${agentOperationalFollowUps.completedAt}, ${agentOperationalFollowUps.dismissedAt}) >= ${resolvedSince}`,
        ),
      )
      .orderBy(desc(sql`coalesce(${agentOperationalFollowUps.completedAt}, ${agentOperationalFollowUps.dismissedAt})`))
      .limit(limit),
  ]);

  const followUpIds = openFollowUps.map((row) => row.id);

  // Proposta mais recente por FollowUp — uma única query, agrupada em
  // memória (nunca N+1: `inArray` traz tudo de uma vez).
  const proposals =
    followUpIds.length > 0
      ? await db
          .select({
            id: agentOperationalActionProposals.id,
            followUpId: agentOperationalActionProposals.followUpId,
            status: agentOperationalActionProposals.status,
            actionPlanId: agentOperationalActionProposals.actionPlanId,
            createdAt: agentOperationalActionProposals.createdAt,
          })
          .from(agentOperationalActionProposals)
          .where(inArray(agentOperationalActionProposals.followUpId, followUpIds))
          .orderBy(desc(agentOperationalActionProposals.createdAt))
      : [];

  const latestProposalByFollowUp = new Map<number, (typeof proposals)[number]>();
  for (const proposal of proposals) {
    if (!latestProposalByFollowUp.has(proposal.followUpId)) {
      latestProposalByFollowUp.set(proposal.followUpId, proposal);
    }
  }

  const planIds = [...latestProposalByFollowUp.values()].map((p) => p.actionPlanId).filter((id): id is number => id !== null);

  const pendingApprovalPlanIds = new Set<number>();
  if (planIds.length > 0) {
    const rows = await db
      .select({ planId: agentActionPlanItems.planId })
      .from(agentApprovals)
      .innerJoin(agentActionPlanItems, eq(agentApprovals.planItemId, agentActionPlanItems.id))
      .where(and(eq(agentApprovals.status, 'pending'), inArray(agentActionPlanItems.planId, planIds)));
    for (const row of rows) pendingApprovalPlanIds.add(row.planId);
  }

  const queues: Record<OperationalQueueName, OperationalQueueItem[]> = {
    needs_attention_now: [],
    awaiting_human: [],
    failed: [],
    in_progress: [],
    resolved_recently: [],
  };

  for (const followUp of openFollowUps) {
    const latestProposal = latestProposalByFollowUp.get(followUp.id) ?? null;
    const hasPendingApproval = latestProposal?.actionPlanId ? pendingApprovalPlanIds.has(latestProposal.actionPlanId) : false;
    const overdue = followUp.dueAt !== null && followUp.dueAt.getTime() < now.getTime();

    let queue: OperationalQueueName;
    let reason: string;

    if (overdue || followUp.priority === 'critical') {
      queue = 'needs_attention_now';
      reason = overdue ? 'FollowUp vencido (dueAt no passado).' : 'Prioridade crítica.';
    } else if (latestProposal?.status === 'failed') {
      queue = 'failed';
      reason = 'A Proposal mais recente terminou failed.';
    } else if (hasPendingApproval) {
      queue = 'awaiting_human';
      reason = 'Action Plan da Proposal mais recente tem uma Approval pendente.';
    } else if (latestProposal?.status === 'submitted') {
      queue = 'awaiting_human';
      reason = 'Proposal criada mas ainda não submetida ao pipeline oficial.';
    } else if (followUp.status === 'open') {
      queue = 'awaiting_human';
      reason = 'FollowUp aberto — ninguém iniciou o acompanhamento ainda.';
    } else {
      queue = 'in_progress';
      reason = `FollowUp em "${followUp.status}", sem pendência humana ou falha detectada.`;
    }

    queues[queue].push({
      followUpId: followUp.id,
      title: followUp.title,
      status: followUp.status,
      priority: followUp.priority,
      dueAt: followUp.dueAt?.toISOString() ?? null,
      updatedAt: followUp.updatedAt.toISOString(),
      responsibilityId: followUp.responsibilityId,
      escalationId: followUp.escalationId,
      ownerAgentId: followUp.ownerAgentId,
      latestProposalId: latestProposal?.id ?? null,
      latestProposalStatus: latestProposal?.status ?? null,
      actionPlanId: latestProposal?.actionPlanId ?? null,
      hasPendingApproval,
      queue,
      reason,
    });
  }

  for (const followUp of resolvedFollowUps) {
    queues.resolved_recently.push({
      followUpId: followUp.id,
      title: followUp.title,
      status: followUp.status,
      priority: followUp.priority,
      dueAt: followUp.dueAt?.toISOString() ?? null,
      updatedAt: followUp.updatedAt.toISOString(),
      responsibilityId: followUp.responsibilityId,
      escalationId: followUp.escalationId,
      ownerAgentId: followUp.ownerAgentId,
      latestProposalId: null,
      latestProposalStatus: null,
      actionPlanId: null,
      hasPendingApproval: false,
      queue: 'resolved_recently',
      reason: followUp.status === 'completed' ? 'Concluído nos últimos 7 dias.' : 'Descartado nos últimos 7 dias.',
    });
  }

  for (const name of Object.keys(queues) as OperationalQueueName[]) {
    queues[name] = queues[name]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  return queues;
}

export interface TimelineEvent {
  action: string;
  entityType: string;
  entityId: string | null;
  actorType: string;
  actorId: string | null;
  userId: number | null;
  metadata: unknown;
  createdAt: string;
  /** true quando o evento pertence a um Action Plan/Item — só presente na
   * resposta se o ator tiver `agents.plan.read` (Etapa 6). */
  requiresPlanRead: boolean;
}

const PLAN_LEVEL_ENTITY_TYPES = new Set(['agent_action_plan', 'agent_action_plan_item', 'agent_approval']);

/**
 * Agentes v3.0 (correio.md "Etapa 3 — Timeline operacional") — reusa
 * INTEIRAMENTE o audit log existente (`audit_logs`, indexado por
 * `entityType`+`entityId`) — nenhuma segunda fonte de histórico, nenhuma
 * tabela nova. Resolve a cadeia real
 * `Responsibility → Escalation → FollowUp → Proposal → Action Plan(s) →
 * Approval(s)` a partir das FKs reais já persistidas (nunca inferida por
 * heurística), busca o audit de cada entidade encontrada, e devolve tudo
 * ordenado por `createdAt` — a ORDEM TEMPORAL real dos eventos, nunca uma
 * ordem artificial por "importância".
 *
 * Segurança (Etapa 6) — o backend, não o frontend, decide o que entra na
 * timeline: eventos de Action Plan/Item/Approval (`PLAN_LEVEL_ENTITY_TYPES`)
 * só são incluídos se o ator (`requestingUserId`) tiver `agents.plan.read`
 * — mesmo padrão do componente `ActionPlanEvidence` do frontend (v2.9),
 * agora também aplicado aqui, no servidor, independente do cliente.
 */
export async function getFollowUpTimeline(followUpId: number, requestingUserId: number): Promise<TimelineEvent[] | null> {
  const [followUp] = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, followUpId)).limit(1);
  if (!followUp) return null;

  const entityKeys: Array<{ entityType: string; entityId: string }> = [
    { entityType: 'agent_responsibility', entityId: String(followUp.responsibilityId) },
    { entityType: 'agent_operational_follow_up', entityId: String(followUp.id) },
  ];
  if (followUp.escalationId) {
    entityKeys.push({ entityType: 'agent_operational_escalation', entityId: String(followUp.escalationId) });
  }

  const proposals = await db
    .select({ id: agentOperationalActionProposals.id, actionPlanId: agentOperationalActionProposals.actionPlanId })
    .from(agentOperationalActionProposals)
    .where(eq(agentOperationalActionProposals.followUpId, followUp.id));

  for (const proposal of proposals) {
    entityKeys.push({ entityType: 'agent_operational_action_proposal', entityId: String(proposal.id) });
  }

  const planIds = proposals.map((p) => p.actionPlanId).filter((id): id is number => id !== null);

  const permissions = await getUserPermissionSlugs(requestingUserId);
  const canReadPlans = permissions.has('agents.plan.read');

  if (canReadPlans && planIds.length > 0) {
    for (const planId of planIds) {
      entityKeys.push({ entityType: 'agent_action_plan', entityId: String(planId) });
    }

    const items = await db.select({ id: agentActionPlanItems.id }).from(agentActionPlanItems).where(inArray(agentActionPlanItems.planId, planIds));
    for (const item of items) {
      entityKeys.push({ entityType: 'agent_action_plan_item', entityId: String(item.id) });
    }

    if (items.length > 0) {
      const approvals = await db
        .select({ id: agentApprovals.id })
        .from(agentApprovals)
        .where(
          inArray(
            agentApprovals.planItemId,
            items.map((i) => i.id),
          ),
        );
      for (const approval of approvals) {
        entityKeys.push({ entityType: 'agent_approval', entityId: String(approval.id) });
      }
    }
  }

  if (entityKeys.length === 0) return [];

  // `or` de pares (entityType, entityId) — usa o índice composto
  // `audit_logs_entity_idx` já existente, uma condição por par (o volume
  // por FollowUp é sempre pequeno: uma dúzia de entidades no máximo).
  const conditions = entityKeys.map((key) => and(eq(auditLogs.entityType, key.entityType), eq(auditLogs.entityId, key.entityId)));

  const rows = await db
    .select()
    .from(auditLogs)
    .where(sql`${sql.join(conditions, sql` or `)}`)
    .orderBy(auditLogs.createdAt);

  return rows.map((row) => ({
    action: row.action,
    entityType: row.entityType ?? '',
    entityId: row.entityId,
    actorType: row.actorType,
    actorId: row.actorId,
    userId: row.userId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    requiresPlanRead: PLAN_LEVEL_ENTITY_TYPES.has(row.entityType ?? ''),
  }));
}
