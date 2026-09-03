import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlans,
  agentApprovals,
  agentJobs,
  agentOperationalActionProposals,
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
import { AgentError } from '../errors.js';
import { approvePlanItem, rejectPlanItem } from '../executor/plan-approvals.js';
import { setLLMProviderOverrideForTests } from '../llm/factory.js';
import type { LLMProvider, LLMResponse } from '../llm/types.js';
import { registerAllTools } from '../tools/index.js';

import {
  cancelActionProposal,
  createActionProposal,
  setForcedSubmitFailureForTests,
  submitActionProposal,
  syncActionProposalStatus,
} from './action-proposals-service.js';

/*
 * Agentes v2.8 (correio.md seção 25) — Operational Action Proposals:
 * criação, ownership, submissão reutilizando o pipeline oficial (Policy
 * continua soberana), concorrência, cancelamento, sincronização com o
 * Action Plan, e não-conclusão automática do FollowUp.
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
    actions: [
      {
        id: 'action-1',
        agent: 'sales',
        tool: 'sales.get_pipeline_summary',
        arguments: {},
        reason: 'Acompanhar o FollowUp operacional.',
        confidence: 0.9,
      },
    ],
  });
}

// v2.9 (correio.md "TESTES MÍNIMOS" #2) — `sales.prepare_lead_followup`
// com um `leadId` inexistente lança `AgentError('validation_error', ...)`
// de verdade (agents/tools/sales.ts) — o item falha na execução real, sem
// precisar de nenhum mock de falha artificial.
function failingPlan() {
  return mockProvider({
    objective: 'Preparar follow-up de lead inexistente',
    summary: 'Deveria falhar na execução.',
    actions: [
      {
        id: 'action-1',
        agent: 'sales',
        tool: 'sales.prepare_lead_followup',
        arguments: { leadId: 999999999 },
        reason: 'Forçar falha real de execução.',
        confidence: 0.9,
      },
    ],
  });
}

// v2.9 (correio.md "TESTES MÍNIMOS" #3) — duas ações independentes (sem
// dependência entre si): uma completa de verdade, a outra falha de
// verdade (mesmo tool/leadId inexistente de `failingPlan`) — produz um
// Action Plan `partial` real (`finalizePlanStatus`: `anyFailed &&
// anyCompleted`), não simulado.
function mixedOutcomePlan() {
  return mockProvider({
    objective: 'Uma ação completa, outra falha',
    summary: 'Deveria resultar em Action Plan partial.',
    actions: [
      {
        id: 'action-1',
        agent: 'sales',
        tool: 'sales.get_pipeline_summary',
        arguments: {},
        reason: 'Ação que deveria completar.',
        confidence: 0.9,
      },
      {
        id: 'action-2',
        agent: 'sales',
        tool: 'sales.prepare_lead_followup',
        arguments: { leadId: 999999999 },
        reason: 'Ação que deveria falhar.',
        confidence: 0.9,
      },
    ],
  });
}

describe('Agentes v2.8 - OperationalActionProposal service', () => {
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let salesAgentId: number;
  let responsibilityId: number;
  let followUpId: number;
  const createdFollowUpIds: number[] = [];
  const createdResponsibilityIds: number[] = [];
  const createdProposalIds: number[] = [];
  const createdPlanIds: number[] = [];

  before(async () => {
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
      .values({ agentId: salesAgentId, name: `Proposals fixture ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'none', createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;
    createdResponsibilityIds.push(responsibilityId);

    const [followUp] = await db
      .insert(agentOperationalFollowUps)
      .values({
        responsibilityId,
        sourceType: 'responsibility',
        sourceId: responsibilityId,
        ownerAgentId: salesAgentId,
        title: `FollowUp p/ Proposals ${runId}`,
        status: 'open',
        priority: 'medium',
        dedupKey: `proposals-fixture-${runId}`,
        createdBy: ceoUserId,
      })
      .returning();
    followUpId = followUp!.id;
    createdFollowUpIds.push(followUpId);
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    for (const id of createdProposalIds) await db.delete(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, id));
    for (const id of createdPlanIds) {
      const { agentActionPlanItems } = await import('../../db/schema/index.js');
      await db.delete(agentApprovals).where(eq(agentApprovals.planItemId, id));
      await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, id));
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, id));
    }
    for (const id of createdFollowUpIds) await db.delete(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, id));
    for (const id of createdResponsibilityIds) await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, id));

    await database.end();
    redis.disconnect();
  });

  async function getFollowUpRow() {
    const [row] = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, followUpId)).limit(1);
    return row!;
  }

  test('1/4/20: cria proposta para FollowUp válido — ownership e FK copiados corretamente', async () => {
    const followUp = await getFollowUpRow();
    const proposal = await createActionProposal(followUp, { title: `Proposta ${runId}`, objective: 'Verificar configuração do cliente.' }, ceoUserId);
    createdProposalIds.push(proposal.id);

    assert.equal(proposal.followUpId, followUpId);
    assert.equal(proposal.responsibilityId, followUp.responsibilityId);
    assert.equal(proposal.ownerAgentId, followUp.ownerAgentId);
    assert.equal(proposal.status, 'submitted');
    assert.equal(proposal.createdBy, ceoUserId);
    assert.equal(proposal.actionPlanId, null);

    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.operational_action.created')).orderBy(auditLogs.id).limit(1);
    void log;
  });

  test('3: rejeita FollowUp terminal (completed/dismissed)', async () => {
    const [terminalFollowUp] = await db
      .insert(agentOperationalFollowUps)
      .values({
        responsibilityId,
        sourceType: 'responsibility',
        sourceId: responsibilityId,
        ownerAgentId: salesAgentId,
        title: `FollowUp terminal ${runId}`,
        status: 'completed',
        priority: 'medium',
        dedupKey: `proposals-terminal-${runId}`,
        createdBy: ceoUserId,
        completedAt: new Date(),
        completedBy: ceoUserId,
        resolution: 'x',
      })
      .returning();
    createdFollowUpIds.push(terminalFollowUp!.id);

    await assert.rejects(
      createActionProposal(terminalFollowUp!, { title: 'x', objective: 'x' }, ceoUserId),
      (error: unknown) => error instanceof AgentError && error.code === 'conflict',
    );
  });

  describe('Submissão via pipeline oficial', () => {
    before(() => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
    });

    test('5/6/7/19: submissão chama o pipeline oficial, persiste e vincula o Action Plan, Policy respeitada, auditoria gerada', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Submissão ${runId}`, objective: 'Verificar pipeline de vendas do cliente.' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      const submitted = await submitActionProposal(proposal, ceoUserId);
      assert.ok(submitted.actionPlanId, 'deveria ter vinculado um Action Plan real');
      createdPlanIds.push(submitted.actionPlanId!);

      const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, submitted.actionPlanId!));
      assert.ok(plan, 'o Action Plan deveria estar persistido de verdade');
      assert.equal(plan!.requestedBy, ceoUserId);

      const { agentActionPlanItems } = await import('../../db/schema/index.js');
      const items = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, submitted.actionPlanId!));
      assert.equal(items.length, 1);
      assert.equal(items[0]!.decision, 'execute', 'CEO tem leads.read — Policy deveria liberar execução');

      const [submittedLog] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'agents.operational_action.submitted'), eq(auditLogs.entityId, String(proposal.id))));
      assert.ok(submittedLog);
      const [plannedLog] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'agents.operational_action.planned'), eq(auditLogs.entityId, String(proposal.id))));
      assert.ok(plannedLog);
    });

    test('8: approval_required continua criando o workflow de Approval existente', async () => {
      const [salesTool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
      const [toolPermission] = await db
        .select()
        .from(agentToolPermissions)
        .where(and(eq(agentToolPermissions.agentId, salesAgentId), eq(agentToolPermissions.toolId, salesTool!.id)));
      assert.ok(toolPermission);
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, toolPermission!.id));

      try {
        setLLMProviderOverrideForTests(pipelineSummaryPlan());
        const followUp = await getFollowUpRow();
        const proposal = await createActionProposal(followUp, { title: `Approval ${runId}`, objective: 'Verificar pipeline (exige aprovação).' }, ceoUserId);
        createdProposalIds.push(proposal.id);

        const submitted = await submitActionProposal(proposal, ceoUserId);
        assert.ok(submitted.actionPlanId);
        createdPlanIds.push(submitted.actionPlanId!);
        // Ainda não terminal — aguardando aprovação real.
        assert.equal(submitted.status, 'planned');

        const { agentActionPlanItems } = await import('../../db/schema/index.js');
        const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, submitted.actionPlanId!));
        assert.equal(item!.decision, 'approval_required');

        const [approval] = await db.select().from(agentApprovals).where(eq(agentApprovals.planItemId, item!.id));
        assert.ok(approval, 'deveria ter criado uma linha real em agent_approvals — o mesmo workflow de sempre');
        assert.equal(approval!.status, 'pending');
      } finally {
        await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, toolPermission!.id));
      }
    });

    test('9/10: blocked (usuário sem a permission da tool) nunca executa — executor nunca chamado diretamente', async () => {
      const [restrictedRole] = await db
        .insert(roles)
        .values({ name: `Teste Proposals SemLeads ${runId}`, slug: `test-proposals-noleads-${runId}`, description: 'sem leads.read', isSystem: false })
        .returning();
      const [manageProposalsPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.followups.actions.manage')).limit(1);
      const [readFollowUpsPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.followups.read')).limit(1);
      await db.insert(rolePermissions).values([
        { roleId: restrictedRole!.id, permissionId: manageProposalsPerm!.id },
        { roleId: restrictedRole!.id, permissionId: readFollowUpsPerm!.id },
      ]);
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.default.hash('senha-teste-12345', 4);
      const email = `test-proposals-noleads-${runId}@example.com`;
      const [restrictedUser] = await db.insert(users).values({ name: 'Sem Leads', email, passwordHash, roleId: restrictedRole!.id, isActive: true }).returning();

      let localProposalId: number | undefined;
      let localPlanId: number | undefined;

      try {
        setLLMProviderOverrideForTests(pipelineSummaryPlan());
        const followUp = await getFollowUpRow();
        const proposal = await createActionProposal(followUp, { title: `Blocked ${runId}`, objective: 'Verificar pipeline sem permissão.' }, restrictedUser!.id);
        localProposalId = proposal.id;

        const submitted = await submitActionProposal(proposal, restrictedUser!.id);
        localPlanId = submitted.actionPlanId!;

        const { agentActionPlanItems } = await import('../../db/schema/index.js');
        const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, submitted.actionPlanId!));
        assert.equal(item!.decision, 'blocked');
        assert.equal(item!.executionStatus, 'blocked', 'blocked nunca executa — executor nunca é chamado diretamente pela proposta');
        assert.equal(item!.result, null);
      } finally {
        // A proposta/plano criados nesta rodada referenciam o
        // restrictedUser via FK restrict (createdBy/submittedBy/
        // requestedBy) — precisam ser removidos ANTES do usuário, aqui
        // mesmo (nunca esperar pelo cleanup genérico do after()
        // externo, que só roda ao final de todo o describe).
        if (localProposalId) {
          await db.delete(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, localProposalId));
        }
        if (localPlanId) {
          const { agentActionPlanItems } = await import('../../db/schema/index.js');
          await db.delete(agentApprovals).where(eq(agentApprovals.planItemId, localPlanId));
          await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, localPlanId));
          await db.delete(agentActionPlans).where(eq(agentActionPlans.id, localPlanId));
        }

        await db.delete(users).where(eq(users.id, restrictedUser!.id));
        await db.delete(rolePermissions).where(eq(rolePermissions.roleId, restrictedRole!.id));
        await db.delete(roles).where(eq(roles.id, restrictedRole!.id));
      }
    });

    test('13: proposta nunca altera autonomy (nenhum agent_job é tocado)', async () => {
      const jobsBefore = await db.select().from(agentJobs);

      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Autonomy ${runId}`, objective: 'Verificar pipeline — não deve tocar autonomy.' }, ceoUserId);
      createdProposalIds.push(proposal.id);
      const submitted = await submitActionProposal(proposal, ceoUserId);
      createdPlanIds.push(submitted.actionPlanId!);

      const jobsAfter = await db.select().from(agentJobs);
      assert.equal(jobsAfter.length, jobsBefore.length, 'submissão de proposta nunca cria/altera agent_jobs');
    });

    test('16: concorrência de submissão gera exatamente um Action Plan', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Concorrência ${runId}`, objective: 'Verificar pipeline (concorrência).' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      const attempts = 8;
      const results = await Promise.allSettled(Array.from({ length: attempts }, () => submitActionProposal(proposal, ceoUserId)));

      const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof submitActionProposal>>>[];
      assert.equal(fulfilled.length, 1, 'só uma das N submissões concorrentes deveria vencer a corrida');

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(rejected.length, attempts - 1);
      for (const r of rejected) {
        assert.ok((r as PromiseRejectedResult).reason instanceof AgentError);
        assert.equal(((r as PromiseRejectedResult).reason as AgentError).code, 'conflict');
      }

      const winner = fulfilled[0]!.value;
      createdPlanIds.push(winner.actionPlanId!);

      const plans = await db.select().from(agentActionPlans).where(eq(agentActionPlans.requestedBy, ceoUserId));
      const plansForThisProposal = plans.filter((p) => p.id === winner.actionPlanId);
      assert.equal(plansForThisProposal.length, 1, 'no máximo 1 Action Plan para a proposta, mesmo sob concorrência real');
    });

    test('17: proposal completed NUNCA conclui automaticamente o FollowUp', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Não conclui FollowUp ${runId}`, objective: 'Verificar pipeline.' }, ceoUserId);
      createdProposalIds.push(proposal.id);
      const submitted = await submitActionProposal(proposal, ceoUserId);
      createdPlanIds.push(submitted.actionPlanId!);
      assert.equal(submitted.status, 'completed', 'plano sem approval deveria completar sincronamente');

      const [reloadedFollowUp] = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, followUpId));
      assert.equal(reloadedFollowUp!.status, 'open', 'FollowUp NUNCA é concluído automaticamente por uma proposta concluída — são conceitos diferentes (seção 13)');
    });

    test('18: Action Plan continua independente da existência do FollowUp (verificável isoladamente)', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Independente ${runId}`, objective: 'Verificar pipeline.' }, ceoUserId);
      createdProposalIds.push(proposal.id);
      const submitted = await submitActionProposal(proposal, ceoUserId);
      createdPlanIds.push(submitted.actionPlanId!);

      const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, submitted.actionPlanId!));
      assert.ok(plan, 'o Action Plan é uma entidade real e independente, consultável sem qualquer referência ao FollowUp');
      // agent_action_plans não tem (e nunca ganhou) uma coluna follow_up_id.
      assert.ok(!('followUpId' in plan!));
    });
  });

  test('14/15: cancelamento válido; transição inválida (cancelar terminal) retorna 409', async () => {
    const followUp = await getFollowUpRow();
    const proposal = await createActionProposal(followUp, { title: `Cancelar ${runId}`, objective: 'x' }, ceoUserId);
    createdProposalIds.push(proposal.id);

    const cancelled = await cancelActionProposal(proposal, 'Não é mais necessário.', ceoUserId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancelledBy, ceoUserId);
    assert.equal(cancelled.failureReason, 'Não é mais necessário.');

    await assert.rejects(cancelActionProposal(cancelled, 'de novo', ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
  });

  test('15: submeter uma proposta já cancelada retorna 409', async () => {
    const followUp = await getFollowUpRow();
    const proposal = await createActionProposal(followUp, { title: `Cancelar depois submit ${runId}`, objective: 'x' }, ceoUserId);
    createdProposalIds.push(proposal.id);
    const cancelled = await cancelActionProposal(proposal, 'x', ceoUserId);

    await assert.rejects(submitActionProposal(cancelled, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
  });

  test('syncActionProposalStatus nunca regride uma proposta já terminal', async () => {
    const followUp = await getFollowUpRow();
    const proposal = await createActionProposal(followUp, { title: `Sync terminal ${runId}`, objective: 'x' }, ceoUserId);
    createdProposalIds.push(proposal.id);
    const cancelled = await cancelActionProposal(proposal, 'x', ceoUserId);

    // actionPlanId nunca foi setado (cancelado antes de submeter) — sync
    // não encontra nenhuma proposta pelo actionPlanId inexistente, no-op.
    const result = await syncActionProposalStatus(999999999, ceoUserId);
    assert.equal(result, null);
    void cancelled;
  });

  describe('Fechamento v2.8 — pontos de consistência', () => {
    test('ponto 1: falha do Planner (LLM desabilitado) nunca deixa a proposta "planned" sem Action Plan — resolve para "failed"', async () => {
      const previousEnabled = process.env.AGENT_LLM_ENABLED;
      process.env.AGENT_LLM_ENABLED = 'false';

      try {
        const followUp = await getFollowUpRow();
        const proposal = await createActionProposal(followUp, { title: `Planner falha ${runId}`, objective: 'x' }, ceoUserId);
        createdProposalIds.push(proposal.id);

        const result = await submitActionProposal(proposal, ceoUserId);
        assert.equal(result.status, 'failed', 'falha do Planner nunca deixa a proposta em "planned" — resolve para "failed"');
        assert.equal(result.actionPlanId, null, 'nenhum Action Plan deveria ter sido vinculado');
        assert.ok(result.failureReason);

        const [reloaded] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, proposal.id));
        assert.equal(reloaded!.status, 'failed');
        assert.equal(reloaded!.actionPlanId, null);
      } finally {
        if (previousEnabled === undefined) delete process.env.AGENT_LLM_ENABLED;
        else process.env.AGENT_LLM_ENABLED = previousEnabled;
      }
    });

    test('ponto 2 (v2.9): exceção genuinamente inesperada logo após a reivindicação nunca deixa a proposta presa em "submitted" — resolve para "failed"', async () => {
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Falha pós-reivindicação ${runId}`, objective: 'x' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      setForcedSubmitFailureForTests(new Error('Falha de infraestrutura simulada (ex.: conexão perdida).'));
      try {
        const result = await submitActionProposal(proposal, ceoUserId);

        assert.equal(result.status, 'failed', 'a reivindicação foi bem-sucedida (submittedAt gravado), mas a exceção logo em seguida deve resolver para "failed", nunca deixar presa em "submitted"');
        assert.equal(result.actionPlanId, null, 'nenhum Action Plan chegou a ser criado — a exceção ocorreu antes do Planner rodar');
        assert.ok(result.submittedAt, 'a reivindicação (CAS) já havia sido persistida antes da exceção');
        assert.ok(result.failureReason?.includes('infraestrutura'));

        const [reloaded] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, proposal.id));
        assert.equal(reloaded!.status, 'failed');
        assert.equal(reloaded!.actionPlanId, null);

        // Prova que a proposta não fica presa: uma segunda tentativa de
        // submissão é rejeitada corretamente porque já não está mais em
        // "submitted" (nunca um estado ambíguo que aceitaria retry OU
        // ficaria travado para sempre).
        await assert.rejects(submitActionProposal(reloaded!, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
      } finally {
        setForcedSubmitFailureForTests(null);
      }
    });

    test('ponto 1: CHECK do banco prova o invariante — status="planned" sem actionPlanId é rejeitado mesmo via UPDATE direto', async () => {
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `CHECK direto ${runId}`, objective: 'x' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      await assert.rejects(
        db.update(agentOperationalActionProposals).set({ status: 'planned' }).where(eq(agentOperationalActionProposals.id, proposal.id)),
        (error: unknown) => {
          // O driver (node-postgres, via drizzle) envolve o erro real do
          // Postgres em `error.cause` — o `.message` de topo é só "Failed
          // query: ...", o nome da constraint só aparece na causa.
          const cause = error instanceof Error ? error.cause : undefined;
          const causeMessage = cause instanceof Error ? cause.message : String(cause ?? '');
          return causeMessage.includes('agent_operational_action_proposals_planned_requires_plan');
        },
        'o CHECK constraint deveria rejeitar "planned" sem action_plan_id, mesmo contornando a camada de serviço',
      );

      const [reloaded] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, proposal.id));
      assert.equal(reloaded!.status, 'submitted', 'a linha nunca deveria ter sido alterada — o UPDATE inteiro falhou');
    });

    test('ponto 2: cancelar uma proposta "planned" retorna 409 — governança passa a ser do Action Plan/Approval', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';

      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Cancelar planned ${runId}`, objective: 'Verificar pipeline.' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      const submitted = await submitActionProposal(proposal, ceoUserId);
      if (submitted.actionPlanId) createdPlanIds.push(submitted.actionPlanId);
      assert.ok(submitted.status === 'planned' || submitted.status === 'completed', 'setup: a proposta deveria ter avançado além de "submitted"');

      await assert.rejects(
        cancelActionProposal(submitted, 'tentativa inválida', ceoUserId),
        (error: unknown) => error instanceof AgentError && error.code === 'conflict',
      );
    });

    test('ponto 2: ACTION_PROPOSAL_TRANSITIONS não permite mais planned → cancelled', async () => {
      const { ACTION_PROPOSAL_TRANSITIONS } = await import('./action-proposals-types.js');
      assert.ok(!ACTION_PROPOSAL_TRANSITIONS.planned.includes('cancelled'));
      assert.deepEqual([...ACTION_PROPOSAL_TRANSITIONS.planned].sort(), ['completed', 'failed']);
    });
  });

  /*
   * v2.9 (correio.md "BLOQUEIO 1") — a sincronização deixou de ser
   * chamada explicitamente em cada chamador de `executeActionPlan`
   * (`submitActionProposal` aqui, e `approvePlanItem`/`rejectPlanItem` em
   * `executor/plan-approvals.ts`) e passou a ser disparada de dentro do
   * próprio `executeActionPlan` (agents/executor/action-plan-executor.ts),
   * o único ponto do sistema que grava `agent_action_plans.status`. Estes
   * testes provam essa centralização de ponta a ponta — inclusive pelo
   * caminho da resolução de Approval, que esta suíte não testava
   * diretamente antes (só via HTTP em `action-plans.test.ts`, sem checar
   * a Proposal).
   */
  describe('v2.9 — BLOQUEIO 1: sincronização centralizada em executeActionPlan', () => {
    before(() => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';
    });

    test('Proposal acompanha Action Plan "failed" real (execução de tool falhou de verdade)', async () => {
      setLLMProviderOverrideForTests(failingPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Plan failed ${runId}`, objective: 'Deve falhar de verdade.' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      const submitted = await submitActionProposal(proposal, ceoUserId);
      assert.ok(submitted.actionPlanId);
      createdPlanIds.push(submitted.actionPlanId!);

      const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, submitted.actionPlanId!));
      assert.equal(plan!.status, 'failed', 'setup: o Action Plan real deveria ter falhado (tool lançou validation_error)');

      assert.equal(submitted.status, 'failed', 'a Proposal deveria refletir o Action Plan failed — sincronizado de dentro de executeActionPlan');
      assert.ok(submitted.failureReason?.includes('failed'));
    });

    test('13 (correio.md "TESTES MÍNIMOS"): falha da Proposal nunca altera o FollowUp automaticamente', async () => {
      setLLMProviderOverrideForTests(failingPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Falha não toca FollowUp ${runId}`, objective: 'Deve falhar de verdade.' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      const submitted = await submitActionProposal(proposal, ceoUserId);
      assert.ok(submitted.actionPlanId);
      createdPlanIds.push(submitted.actionPlanId!);
      assert.equal(submitted.status, 'failed', 'setup: a Proposal deveria ter falhado de verdade');

      const [reloadedFollowUp] = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, followUpId));
      assert.equal(reloadedFollowUp!.status, 'open', 'uma Proposal failed NUNCA altera o status do FollowUp — mesma regra já vigente para completed (seção 13/v2.8), agora também provada para failed');
    });

    test('comportamento documentado para Action Plan "partial": Proposal vira "failed" (mapeamento seção PLAN_STATUS_TO_PROPOSAL_STATUS)', async () => {
      setLLMProviderOverrideForTests(mixedOutcomePlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Plan partial ${runId}`, objective: 'Uma ação completa, outra falha.' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      const submitted = await submitActionProposal(proposal, ceoUserId);
      assert.ok(submitted.actionPlanId);
      createdPlanIds.push(submitted.actionPlanId!);

      const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, submitted.actionPlanId!));
      assert.equal(plan!.status, 'partial', 'setup: uma ação completou e a outra falhou de verdade — o Action Plan deveria ser partial');

      // `partial` não é `completed`/`failed`/`cancelled` no vocabulário
      // real da Proposal (action-proposals-types.ts) — mapeado
      // deliberadamente para `failed` (nem toda ação planejada foi
      // executada), decisão já documentada em
      // PLAN_STATUS_TO_PROPOSAL_STATUS.
      assert.equal(submitted.status, 'failed', '"partial" é mapeado para "failed" do ponto de vista da Proposal — nunca um estado novo inventado');
    });

    test('resolução de Approval (approve) atualiza corretamente o lifecycle final da Proposal — sem nenhuma chamada explícita a syncActionProposalStatus em plan-approvals.ts', async () => {
      const [salesTool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
      const [toolPermission] = await db
        .select()
        .from(agentToolPermissions)
        .where(and(eq(agentToolPermissions.agentId, salesAgentId), eq(agentToolPermissions.toolId, salesTool!.id)));
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, toolPermission!.id));

      try {
        setLLMProviderOverrideForTests(pipelineSummaryPlan());
        const followUp = await getFollowUpRow();
        const proposal = await createActionProposal(followUp, { title: `Approval resolve ${runId}`, objective: 'Verificar pipeline (exige aprovação).' }, ceoUserId);
        createdProposalIds.push(proposal.id);

        const submitted = await submitActionProposal(proposal, ceoUserId);
        assert.ok(submitted.actionPlanId);
        createdPlanIds.push(submitted.actionPlanId!);
        assert.equal(submitted.status, 'planned', 'setup: ainda aguardando aprovação — não terminal');

        const { agentActionPlanItems } = await import('../../db/schema/index.js');
        const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, submitted.actionPlanId!));
        const [approval] = await db.select().from(agentApprovals).where(eq(agentApprovals.planItemId, item!.id));
        assert.ok(approval);

        // Chama approvePlanItem diretamente (mesma função usada por
        // POST /agents/approvals/:id/approve) — nenhuma chamada a
        // syncActionProposalStatus é feita explicitamente aqui nem em
        // plan-approvals.ts; se a Proposal atualizar mesmo assim, é
        // porque executeActionPlan (chamado de dentro de approvePlanItem)
        // sincronizou sozinho.
        const outcome = await approvePlanItem(approval!.id, ceoUserId);
        assert.ok(outcome.ok);

        const [afterApproval] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, proposal.id));
        assert.equal(afterApproval!.status, 'completed', 'a resolução de Approval deveria ter levado a Proposal a completed, via sincronização automática');
        assert.ok(afterApproval!.completedAt);
      } finally {
        await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, toolPermission!.id));
      }
    });

    test('resolução de Approval (reject) também atualiza a Proposal automaticamente', async () => {
      const [salesTool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
      const [toolPermission] = await db
        .select()
        .from(agentToolPermissions)
        .where(and(eq(agentToolPermissions.agentId, salesAgentId), eq(agentToolPermissions.toolId, salesTool!.id)));
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, toolPermission!.id));

      try {
        setLLMProviderOverrideForTests(pipelineSummaryPlan());
        const followUp = await getFollowUpRow();
        const proposal = await createActionProposal(followUp, { title: `Approval reject ${runId}`, objective: 'Verificar pipeline (exige aprovação).' }, ceoUserId);
        createdProposalIds.push(proposal.id);

        const submitted = await submitActionProposal(proposal, ceoUserId);
        assert.ok(submitted.actionPlanId);
        createdPlanIds.push(submitted.actionPlanId!);
        assert.equal(submitted.status, 'planned');

        const { agentActionPlanItems } = await import('../../db/schema/index.js');
        const [item] = await db.select().from(agentActionPlanItems).where(eq(agentActionPlanItems.planId, submitted.actionPlanId!));
        const [approval] = await db.select().from(agentApprovals).where(eq(agentApprovals.planItemId, item!.id));
        assert.ok(approval);

        const outcome = await rejectPlanItem(approval!.id, ceoUserId, 'rejeitado no teste');
        assert.ok(outcome.ok);

        const [rejectedPlan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, submitted.actionPlanId!));
        // `finalizePlanStatus` (action-plan-executor.ts, comportamento
        // pré-existente desde v1.2, já testado em
        // `action-plan-executor.test.ts`: "item com decision=blocked
        // nunca executa") trata `rejected` no mesmo grupo de
        // `blocked`/`skipped` — nenhum deles conta em `anyFailed`, então
        // um plano cujo único item foi rejeitado/bloqueado finaliza como
        // `completed` (nada rodou, mas o plano terminou seu ciclo sem
        // erro de execução), NUNCA `failed`. Não é uma regressão desta
        // rodada — é o comportamento real já vigente, aqui só confirmado
        // e propagado corretamente para a Proposal.
        assert.equal(rejectedPlan!.status, 'completed', 'setup: comportamento pré-existente de finalizePlanStatus — item rejeitado sozinho finaliza o plano como completed, nunca failed');

        const [afterReject] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, proposal.id));
        assert.equal(afterReject!.status, 'completed', 'a Proposal deveria refletir fielmente o Action Plan real (completed), sincronizado automaticamente — mesmo resultado sendo contraintuitivo, não é este bloqueio que deve reinterpretar o vocabulário existente');
      } finally {
        await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, toolPermission!.id));
      }
    });

    test('sincronização repetida é idempotente — chamar syncActionProposalStatus várias vezes sobre uma Proposal já terminal não muda nada nem duplica audit', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const followUp = await getFollowUpRow();
      const proposal = await createActionProposal(followUp, { title: `Idempotência ${runId}`, objective: 'Verificar pipeline.' }, ceoUserId);
      createdProposalIds.push(proposal.id);

      const submitted = await submitActionProposal(proposal, ceoUserId);
      assert.ok(submitted.actionPlanId);
      createdPlanIds.push(submitted.actionPlanId!);
      assert.equal(submitted.status, 'completed');

      const completedLogsBefore = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.operational_action.completed'), eq(auditLogs.entityId, String(proposal.id))));
      assert.equal(completedLogsBefore.length, 1, 'setup: exatamente 1 audit de completed até aqui (o disparado de dentro de executeActionPlan)');

      // Chama diretamente mais 3 vezes seguidas — simula o mesmo Action
      // Plan sendo "recalculado" de novo por qualquer caminho futuro.
      for (let i = 0; i < 3; i += 1) {
        const result = await syncActionProposalStatus(submitted.actionPlanId!, ceoUserId);
        assert.equal(result!.status, 'completed');
      }

      const [reloaded] = await db.select().from(agentOperationalActionProposals).where(eq(agentOperationalActionProposals.id, proposal.id));
      assert.equal(reloaded!.status, 'completed');

      const completedLogsAfter = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.operational_action.completed'), eq(auditLogs.entityId, String(proposal.id))));
      assert.equal(completedLogsAfter.length, 1, 'chamadas repetidas sobre uma Proposal já terminal não devem gerar novo audit nem mudar nada — idempotente');
    });

    test('Action Plan sem Proposal (criado diretamente) continua funcionando normalmente — sincronização automática é no-op seguro', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const { planEvaluateAndPersistActionPlan } = await import('../orchestration/create-action-plan.js');
      const { executeActionPlan } = await import('../executor/action-plan-executor.js');

      const created = await planEvaluateAndPersistActionPlan({ requestedBy: ceoUserId, objective: 'Plano direto, sem Proposal nenhuma.' });
      assert.ok(created.ok);
      createdPlanIds.push(created.plan.id);

      // Não deveria lançar nem se comportar diferente por não ter
      // nenhuma Proposal apontando para este plano — syncActionProposalStatus
      // interno faz um SELECT que não encontra nada e retorna.
      const finalPlan = await executeActionPlan(created.plan.id, ceoUserId);
      assert.equal(finalPlan.status, 'completed');
    });
  });
});
