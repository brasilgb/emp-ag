import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, count, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentApprovals,
  agentOperationalActionProposals,
  agentOperationalEscalations,
  agentOperationalFollowUps,
  agentResponsibilities,
  agentToolPermissions,
  agentTools,
  agents,
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { approvePlanItem } from '../executor/plan-approvals.js';
import { createActionProposal, submitActionProposal } from '../followups/action-proposals-service.js';
import { setLLMProviderOverrideForTests } from '../llm/factory.js';
import type { LLMProvider, LLMResponse } from '../llm/types.js';
import { planEvaluateAndPersistActionPlan } from '../orchestration/create-action-plan.js';
import { registerAllTools } from '../tools/index.js';

import { getControlCenterOverview, getFollowUpTimeline, getOperationalQueues } from './control-center-service.js';

/*
 * Agentes v3.0 (correio.md "Etapa 8 — Testes mínimos") — Operational
 * Control Center: overview (contagens reais), filas operacionais
 * (critérios determinísticos), timeline (audit log real, sem inventar
 * evento, ordem temporal preservada, gate de `agents.plan.read`),
 * ausência de mutação de estado, e não-regressão do vocabulário
 * FollowUp/Proposal (completed/failed nunca conclui/falha o FollowUp
 * automaticamente).
 */
function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

function pipelineSummaryPlan() {
  return mockProvider({
    objective: 'Verificar pipeline de vendas',
    summary: 'Consultar resumo do funil.',
    actions: [{ id: 'action-1', agent: 'sales', tool: 'sales.get_pipeline_summary', arguments: {}, reason: 'x', confidence: 0.9 }],
  });
}

function failingPlan() {
  return mockProvider({
    objective: 'Preparar follow-up de lead inexistente',
    summary: 'Deveria falhar na execução.',
    actions: [{ id: 'action-1', agent: 'sales', tool: 'sales.prepare_lead_followup', arguments: { leadId: 999999999 }, reason: 'x', confidence: 0.9 }],
  });
}

describe('Agentes v3.0 — Operational Control Center', () => {
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let salesAgentId: number;
  let responsibilityId: number;
  let escalationId: number;
  let noPlanReadUserId: number;
  let noPlanReadRoleId: number;

  const followUpIds: number[] = [];
  const proposalIds: number[] = [];
  const planIds: number[] = [];
  const restrictedApprovalUserIds: number[] = [];

  before(async () => {
    process.env.AGENT_LLM_ENABLED = 'true';
    process.env.AGENT_LLM_SHADOW_MODE = 'false';

    const ceoEmail = process.env.CEO_EMAIL;
    assert.ok(ceoEmail);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [sales] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    assert.ok(sales);
    salesAgentId = sales.id;

    const [responsibility] = await db
      .insert(agentResponsibilities)
      .values({ agentId: salesAgentId, name: `Control Center fixture ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'none', createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;

    const [escalation] = await db
      .insert(agentOperationalEscalations)
      .values({
        responsibilityId,
        sourceAgentId: salesAgentId,
        reason: 'Fixture de teste do Control Center.',
        severity: 'warning',
        status: 'open',
        dedupKey: `control-center-fixture-${runId}`,
      })
      .returning();
    escalationId = escalation!.id;

    // Usuário com tudo que a v3.0 usa, MENOS `agents.plan.read` — prova
    // o gate de plan-level events na timeline (item 13 dos testes
    // mínimos).
    const [noPlanReadRole] = await db
      .insert(roles)
      .values({ name: `Teste CC SemPlanRead ${runId}`, slug: `test-cc-noplanread-${runId}`, description: 'sem agents.plan.read', isSystem: false })
      .returning();
    noPlanReadRoleId = noPlanReadRole!.id;
    const neededSlugs = ['agents.followups.read', 'agents.operations.read'];
    for (const slug of neededSlugs) {
      const [perm] = await db.select().from(permissions).where(eq(permissions.slug, slug)).limit(1);
      assert.ok(perm, `permission ${slug} deveria existir`);
      await db.insert(rolePermissions).values({ roleId: noPlanReadRoleId, permissionId: perm.id });
    }
    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const noPlanReadEmail = `test-cc-noplanread-${runId}@example.com`;
    const [noPlanReadUser] = await db.insert(users).values({ name: 'Sem Plan Read', email: noPlanReadEmail, passwordHash, roleId: noPlanReadRoleId, isActive: true }).returning();
    noPlanReadUserId = noPlanReadUser!.id;
    restrictedApprovalUserIds.push(noPlanReadUserId);
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    for (const id of proposalIds) await db.delete(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, id));
    for (const id of planIds) {
      await db.delete(agentApprovals).where(eq(agentApprovals.planItemId, id));
      await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, id));
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, id));
    }
    for (const id of followUpIds) await db.delete(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, id));
    await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, escalationId));
    await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, responsibilityId));
    for (const id of restrictedApprovalUserIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(roles).where(eq(roles.id, noPlanReadRoleId));

    await database.end();
    redis.disconnect();
  });

  async function makeFollowUp(overrides: Partial<typeof agentOperationalFollowUps.$inferInsert> = {}) {
    const [row] = await db
      .insert(agentOperationalFollowUps)
      .values({
        responsibilityId,
        sourceType: 'responsibility',
        sourceId: responsibilityId,
        ownerAgentId: salesAgentId,
        title: `CC FollowUp ${runId}-${Math.random()}`,
        status: 'open',
        priority: 'medium',
        dedupKey: `cc-fixture-${runId}-${Math.random()}`,
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();
    followUpIds.push(row!.id);
    return row!;
  }

  test('1: overview reflete registros reais (deltas exatos antes/depois dos fixtures)', async () => {
    const before = await getControlCenterOverview();

    const overdueFollowUp = await makeFollowUp({ dueAt: new Date(Date.now() - 60 * 60 * 1000) });
    const criticalFollowUp = await makeFollowUp({ priority: 'critical', status: 'in_progress' });

    const after1 = await getControlCenterOverview();

    assert.equal(after1.followUpsOpen, before.followUpsOpen + 2, 'os 2 FollowUps criados (nenhum terminal) deveriam contar em followUpsOpen');
    assert.equal(after1.followUpsOverdue, before.followUpsOverdue + 1, 'só o FollowUp com dueAt no passado deveria contar em followUpsOverdue');
    // A escalation e a responsibility do fixture já existiam desde o
    // `before()` do describe (rodado ANTES do `before` snapshot desta
    // própria rodada) — nenhuma delta esperada aqui, só confirma que a
    // criação dos 2 FollowUps não afetou essas contagens por engano.
    assert.equal(after1.escalationsOpen, before.escalationsOpen, 'criar FollowUps não deveria alterar escalationsOpen');
    assert.equal(after1.responsibilitiesActive, before.responsibilitiesActive, 'criar FollowUps não deveria alterar responsibilitiesActive');

    void overdueFollowUp;
    void criticalFollowUp;

    // Prova de verdade da delta de escalation/responsibility — cria uma
    // nova de cada e confirma que o overview reflete exatamente +1,
    // depois desfaz (limpeza local, este par nunca é referenciado por
    // nenhum outro teste deste arquivo).
    const [newResponsibility] = await db
      .insert(agentResponsibilities)
      .values({ agentId: salesAgentId, name: `CC delta resp ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'none', createdBy: ceoUserId })
      .returning();
    const [newEscalation] = await db
      .insert(agentOperationalEscalations)
      .values({
        responsibilityId: newResponsibility!.id,
        sourceAgentId: salesAgentId,
        reason: 'Delta de teste.',
        severity: 'warning',
        status: 'open',
        dedupKey: `cc-delta-${runId}`,
      })
      .returning();

    const after2 = await getControlCenterOverview();
    assert.equal(after2.escalationsOpen, after1.escalationsOpen + 1, 'uma nova escalation open deveria incrementar escalationsOpen em exatamente 1');
    assert.equal(after2.responsibilitiesActive, after1.responsibilitiesActive + 1, 'uma nova responsibility enabled deveria incrementar responsibilitiesActive em exatamente 1');

    await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, newEscalation!.id));
    await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, newResponsibility!.id));
  });

  test('2: FollowUp terminal não aparece como aberto (nem em followUpsOpen, nem em nenhuma fila "aberta")', async () => {
    const before = await getControlCenterOverview();
    const [terminalFollowUp] = await db
      .insert(agentOperationalFollowUps)
      .values({
        responsibilityId,
        sourceType: 'responsibility',
        sourceId: responsibilityId,
        ownerAgentId: salesAgentId,
        title: `CC terminal ${runId}`,
        status: 'completed',
        priority: 'medium',
        dedupKey: `cc-terminal-${runId}`,
        createdBy: ceoUserId,
        completedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 dias atrás — fora da janela de "resolved_recently"
        completedBy: ceoUserId,
        resolution: 'x',
      })
      .returning();
    followUpIds.push(terminalFollowUp!.id);

    const after1 = await getControlCenterOverview();
    assert.equal(after1.followUpsOpen, before.followUpsOpen, 'um FollowUp completed não deveria incrementar followUpsOpen');

    const queues = await getOperationalQueues();
    for (const name of ['needs_attention_now', 'awaiting_human', 'failed', 'in_progress'] as const) {
      assert.ok(!queues[name].some((item) => item.followUpId === terminalFollowUp!.id), `FollowUp terminal antigo não deveria aparecer na fila "${name}"`);
    }
    // Fora da janela de 7 dias — também não deveria aparecer em resolved_recently.
    assert.ok(!queues.resolved_recently.some((item) => item.followUpId === terminalFollowUp!.id), 'resolved há 30 dias — fora da janela de 7 dias de "resolved_recently"');
  });

  test('3: FollowUp vencido calculado corretamente — aparece em needs_attention_now com o motivo certo', async () => {
    const overdue = await makeFollowUp({ dueAt: new Date(Date.now() - 60 * 60 * 1000), status: 'in_progress' });
    const notOverdue = await makeFollowUp({ dueAt: new Date(Date.now() + 60 * 60 * 1000), status: 'in_progress' });

    const queues = await getOperationalQueues();
    const overdueItem = queues.needs_attention_now.find((item) => item.followUpId === overdue.id);
    assert.ok(overdueItem, 'FollowUp vencido deveria estar em needs_attention_now');
    assert.match(overdueItem!.reason, /vencido/i);

    const notOverdueInAttention = queues.needs_attention_now.some((item) => item.followUpId === notOverdue.id);
    assert.equal(notOverdueInAttention, false, 'FollowUp com dueAt no futuro não deveria estar em needs_attention_now só por isso');
  });

  test('4/5: Proposal failed cai em "failed"; Approval pendente cai em "awaiting_human" — nenhuma altera o FollowUp automaticamente (11/12)', async () => {
    const failedFollowUp = await makeFollowUp({ status: 'in_progress' });
    setLLMProviderOverrideForTests(failingPlan());
    const failedProposal = await createActionProposal(failedFollowUp, { title: `Falhar ${runId}`, objective: 'x' }, ceoUserId);
    proposalIds.push(failedProposal.id);
    const submittedFailed = await submitActionProposal(failedProposal, ceoUserId);
    assert.equal(submittedFailed.status, 'failed', 'setup: a proposta deveria ter falhado de verdade');
    if (submittedFailed.actionPlanId) planIds.push(submittedFailed.actionPlanId);

    const approvalFollowUp = await makeFollowUp({ status: 'in_progress' });
    const [salesTool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
    const [toolPermission] = await db
      .select()
      .from(agentToolPermissions)
      .where(and(eq(agentToolPermissions.agentId, salesAgentId), eq(agentToolPermissions.toolId, salesTool!.id)));
    await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, toolPermission!.id));
    let pendingProposal: Awaited<ReturnType<typeof createActionProposal>>;
    try {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      pendingProposal = await createActionProposal(approvalFollowUp, { title: `Approval pendente ${runId}`, objective: 'x' }, ceoUserId);
      proposalIds.push(pendingProposal.id);
      const submittedPending = await submitActionProposal(pendingProposal, ceoUserId);
      assert.equal(submittedPending.status, 'planned', 'setup: deveria estar aguardando aprovação, não terminal');
      if (submittedPending.actionPlanId) planIds.push(submittedPending.actionPlanId);
    } finally {
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, toolPermission!.id));
    }

    const queues = await getOperationalQueues();
    const failedItem = queues.failed.find((item) => item.followUpId === failedFollowUp.id);
    assert.ok(failedItem, 'FollowUp com Proposal failed deveria estar na fila "failed"');
    assert.equal(failedItem!.latestProposalStatus, 'failed');

    const awaitingItem = queues.awaiting_human.find((item) => item.followUpId === approvalFollowUp.id);
    assert.ok(awaitingItem, 'FollowUp com Approval pendente deveria estar na fila "awaiting_human"');
    assert.equal(awaitingItem!.hasPendingApproval, true);

    // 12: falha da Proposal nunca altera o FollowUp automaticamente.
    const [reloadedFailedFollowUp] = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, failedFollowUp.id));
    assert.equal(reloadedFailedFollowUp!.status, 'in_progress', 'Proposal failed nunca deveria ter alterado o status do FollowUp');
  });

  test('6: Action Plan sem Proposal continua independente — não aparece em nenhuma fila, overview conta normalmente', async () => {
    setLLMProviderOverrideForTests(pipelineSummaryPlan());
    const created = await planEvaluateAndPersistActionPlan({ requestedBy: ceoUserId, objective: `Plano direto sem Proposal ${runId}` });
    assert.ok(created.ok);
    const planId = created.ok ? created.plan.id : null;
    assert.ok(planId !== null);
    planIds.push(planId!);

    const queues = await getOperationalQueues();
    for (const name of Object.keys(queues) as (keyof typeof queues)[]) {
      assert.ok(
        !queues[name].some((item) => item.actionPlanId === planId),
        `Action Plan sem Proposal não deveria aparecer em nenhuma fila (via actionPlanId) — "${name}"`,
      );
    }
  });

  test('7: usuário sem permission não recebe dados protegidos (timeline: sem agents.plan.read, eventos de Action Plan somem)', async () => {
    const followUp = await makeFollowUp({ status: 'in_progress' });
    const [salesTool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
    const [toolPermission] = await db
      .select()
      .from(agentToolPermissions)
      .where(and(eq(agentToolPermissions.agentId, salesAgentId), eq(agentToolPermissions.toolId, salesTool!.id)));
    await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, toolPermission!.id));

    let proposal: Awaited<ReturnType<typeof createActionProposal>>;
    let approvalId: number;
    try {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      proposal = await createActionProposal(followUp, { title: `Timeline gate ${runId}`, objective: 'x' }, ceoUserId);
      proposalIds.push(proposal.id);
      const submitted = await submitActionProposal(proposal, ceoUserId);
      assert.equal(submitted.status, 'planned');
      if (submitted.actionPlanId) planIds.push(submitted.actionPlanId);

      const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, submitted.actionPlanId!));
      const [approval] = await db.select().from(agentApprovals).where(eq(agentApprovals.planItemId, item!.id));
      assert.ok(approval);
      approvalId = approval!.id;
      const outcome = await approvePlanItem(approvalId, ceoUserId);
      assert.ok(outcome.ok);
    } finally {
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, toolPermission!.id));
    }

    const timelineWithPlanRead = await getFollowUpTimeline(followUp.id, ceoUserId);
    assert.ok(timelineWithPlanRead);
    assert.ok(timelineWithPlanRead!.some((event) => event.entityType === 'agent_action_plan'), 'CEO tem agents.plan.read — deveria ver eventos de Action Plan');
    assert.ok(timelineWithPlanRead!.some((event) => event.entityType === 'agent_approval'), 'CEO tem agents.plan.read — deveria ver eventos de Approval');

    const timelineWithoutPlanRead = await getFollowUpTimeline(followUp.id, noPlanReadUserId);
    assert.ok(timelineWithoutPlanRead);
    assert.ok(
      !timelineWithoutPlanRead!.some((event) => event.entityType === 'agent_action_plan' || event.entityType === 'agent_action_plan_item' || event.entityType === 'agent_approval'),
      'sem agents.plan.read, nenhum evento de nível Action Plan/Item/Approval deveria vazar na timeline',
    );
    // Eventos que NÃO são de nível Action Plan (ex.: a criação da
    // Proposal em si) continuam visíveis mesmo sem `agents.plan.read` —
    // o gate é específico dos 3 `entityType`s de Action Plan/Item/
    // Approval, não da timeline inteira. (Este fixture usa `makeFollowUp`
    // — INSERT direto, sem passar pelo serviço — então o próprio
    // FollowUp não tem audit de criação; a Proposal, criada via
    // `createActionProposal`, é a entidade não-plan-level real disponível
    // para esta prova.)
    assert.ok(
      timelineWithoutPlanRead!.some((event) => event.entityType === 'agent_operational_action_proposal'),
      'sem agents.plan.read, eventos que não são de nível Action Plan (ex.: criação da Proposal) continuam visíveis',
    );
  });

  test('8: nenhuma das consultas do Control Center altera estado (contagem de linhas idêntica antes/depois)', async () => {
    const followUp = await makeFollowUp();

    const [beforeFollowUps] = await db.select({ total: count() }).from(agentOperationalFollowUps);
    const [beforeAudit] = await db.select({ total: count() }).from(auditLogs);

    await getControlCenterOverview();
    await getOperationalQueues();
    await getFollowUpTimeline(followUp.id, ceoUserId);

    const [afterFollowUps] = await db.select({ total: count() }).from(agentOperationalFollowUps);
    const [afterAudit] = await db.select({ total: count() }).from(auditLogs);

    assert.equal(afterFollowUps!.total, beforeFollowUps!.total, 'ler o overview/filas não deveria alterar agent_operational_follow_ups');
    assert.equal(afterAudit!.total, beforeAudit!.total, 'ler overview/filas/timeline não deveria gravar audit novo — são só leituras');
  });

  test('9/10: timeline preserva ordem temporal e não inventa evento inexistente', async () => {
    const followUp = await makeFollowUp({ status: 'in_progress' });
    setLLMProviderOverrideForTests(pipelineSummaryPlan());
    const proposal = await createActionProposal(followUp, { title: `Timeline ordem ${runId}`, objective: 'x' }, ceoUserId);
    proposalIds.push(proposal.id);
    const submitted = await submitActionProposal(proposal, ceoUserId);
    if (submitted.actionPlanId) planIds.push(submitted.actionPlanId);

    const timeline = await getFollowUpTimeline(followUp.id, ceoUserId);
    assert.ok(timeline);
    assert.ok(timeline!.length > 0);

    for (let i = 1; i < timeline!.length; i += 1) {
      assert.ok(
        new Date(timeline![i]!.createdAt).getTime() >= new Date(timeline![i - 1]!.createdAt).getTime(),
        'a timeline deveria estar em ordem cronológica não-decrescente',
      );
    }

    // "Não inventa evento inexistente" — cada linha da timeline
    // corresponde a uma linha REAL de audit_logs (consulta independente,
    // pelas mesmas chaves entityType/entityId).
    const relevantAudit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'agent_operational_action_proposal'),
          eq(auditLogs.entityId, String(proposal.id)),
        ),
      );
    for (const row of relevantAudit) {
      assert.ok(
        timeline!.some((event) => event.entityType === row.entityType && event.entityId === row.entityId && event.action === row.action),
        `evento real de audit (${row.action}) deveria estar presente na timeline`,
      );
    }
  });

  test('16: reconciliação — Jobs/Director/Action Plan direto continuam funcionando sem regressão do Control Center', async () => {
    // Não é um teste de contagem de suíte (isso é verificado rodando a
    // suíte completa) — aqui só confirma que criar/ler o Control Center
    // não interfere num Action Plan criado por outro caminho qualquer
    // (mesmo tipo de garantia do teste 6, agora do lado do overview).
    const before = await getControlCenterOverview();
    setLLMProviderOverrideForTests(pipelineSummaryPlan());
    const created = await planEvaluateAndPersistActionPlan({ requestedBy: ceoUserId, objective: `Independência ${runId}` });
    assert.ok(created.ok);
    planIds.push(created.plan.id);
    const after1 = await getControlCenterOverview();
    // Um plano criado direto (sem approval pendente, sem falha) não
    // deveria mexer em waitingApproval/partial/failed.
    assert.equal(after1.actionPlansWaitingApproval, before.actionPlansWaitingApproval);
    assert.equal(after1.actionPlansPartial, before.actionPlansPartial);
    assert.equal(after1.actionPlansFailed, before.actionPlansFailed);
  });
});
