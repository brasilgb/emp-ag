import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentToolPermissions,
  agentTools,
  agents,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../llm/factory.js';
import { registerAllTools } from '../../tools/index.js';
import type { LLMProvider, LLMResponse } from '../../llm/types.js';
import { AgentError } from '../../errors.js';

import {
  completeInitiativeManually,
  getInitiativeExecutionView,
  startInitiativeExecution,
  syncInitiativeExecutionState,
} from './initiatives-execution-service.js';
import type { InitiativeRow } from './initiatives-service.js';

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

/** Mesmo mock, mas com um atraso artificial — simula uma chamada real ao LLM que demora (saneamento seção 1: provar que nenhum lock fica retido durante isso). */
function delayedProvider(rawResponse: unknown, delayMs: number): LLMProvider {
  return {
    name: 'mock-delayed',
    async complete(): Promise<LLMResponse> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { raw: rawResponse };
    },
  };
}

function pipelineSummaryPlanRaw() {
  return {
    objective: 'Executar iniciativa',
    summary: 'Levantar situação do funil',
    actions: [
      {
        id: 'action-1',
        agent: 'sales',
        tool: 'sales.get_pipeline_summary',
        arguments: {},
        reason: 'Necessário para a iniciativa.',
        confidence: 0.95,
      },
    ],
  };
}

function pipelineSummaryPlan() {
  return mockProvider(pipelineSummaryPlanRaw());
}

/*
 * Agentes v2.1 (correio.md seção 19) — Initiative Execution: cobre as
 * categorias "Execution" (pipeline real) e "Progress"/"Completion"
 * (construídas diretamente sobre Action Plan Items para controlar
 * exatamente cada execution_status, sem depender de um tool real
 * falhar/bloquear em condições difíceis de reproduzir via LLM mockado).
 */
describe('Agentes v2.1 - Initiative Execution', () => {
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let goalId: number;
  let limitedUserId: number;
  let limitedRoleId: number;

  async function insertInitiative(overrides: Partial<typeof agentDirectorInitiatives.$inferInsert> = {}): Promise<InitiativeRow> {
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({
        goalId,
        title: `Initiative Execution ${runId}`,
        description: 'desc',
        domain: 'crm',
        status: 'approved',
        priority: 'medium',
        rationale: 'racional',
        origin: 'manual',
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();
    return initiative!;
  }

  async function deleteInitiative(id: number) {
    const [row] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    if (row?.actionPlanId) {
      await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, row.actionPlanId));
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, row.actionPlanId));
    }
    await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
  }

  /** Constrói um Action Plan + Items diretamente (sem Planner), status controlado, para testar progress/sync isoladamente. */
  async function insertControlledPlan(requestedBy: number, itemStatuses: string[]): Promise<{ planId: number }> {
    const [sale] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, 'sales')).limit(1);
    const [tool] = await db.select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
    assert.ok(sale && tool);

    const [plan] = await db
      .insert(agentActionPlans)
      .values({ requestedBy, objective: 'Objetivo de teste controlado.', summary: 'Resumo de teste.', status: 'executing' })
      .returning();

    for (const [index, executionStatus] of itemStatuses.entries()) {
      await db.insert(agentActionPlanItems).values({
        planId: plan!.id,
        sequence: index,
        actionId: `action-${index}`,
        agent: 'sales',
        agentId: sale!.id,
        tool: 'sales.get_pipeline_summary',
        toolId: tool!.id,
        arguments: {},
        risk: 'read',
        decision: 'execute',
        executionStatus,
      });
    }

    return { planId: plan!.id };
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal p/ Execution ${runId}`,
        description: 'desc',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        createdBy: ceoUserId,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        targetDate: new Date('2026-12-01T00:00:00.000Z'),
        targetType: 'milestone',
      })
      .returning();
    goalId = goal!.id;

    // Usuário restrito: tem agents.use/agents.plan/agents.director.initiatives.manage
    // (passa no preHandler da rota) mas NUNCA leads.read — sales.get_pipeline_summary
    // exige leads.read, então o Policy Evaluator bloqueia por permissão real
    // (mesmo mecanismo de "read sem permission → blocked" já testado em
    // action-policy-evaluator.test.ts), sem precisar inventar nada.
    const neededSlugs = ['agents.use', 'agents.plan', 'agents.director.initiatives.manage', 'agents.read'];
    const allNeeded = await Promise.all(neededSlugs.map((slug) => db.select().from(permissions).where(eq(permissions.slug, slug)).then((r) => r[0])));
    assert.ok(allNeeded.every(Boolean));

    const [role] = await db
      .insert(roles)
      .values({ name: `Teste Execution ${runId}`, slug: `test-execution-${runId}`, description: 'sem leads.read', isSystem: false })
      .returning();
    limitedRoleId = role!.id;
    await db.insert(rolePermissions).values(allNeeded.map((permission) => ({ roleId: role!.id, permissionId: permission!.id })));

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const [user] = await db
      .insert(users)
      .values({ name: 'Sem Leads Read', email: `test-execution-${runId}@example.com`, passwordHash, roleId: role!.id, isActive: true })
      .returning();
    limitedUserId = user!.id;
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    await db.delete(users).where(eq(users.id, limitedUserId));
    await db.delete(roles).where(eq(roles.id, limitedRoleId));
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  describe('getInitiativeExecutionView', () => {
    test('sem actionPlanId → not_started, todos os campos zerados', async () => {
      const initiative = await insertInitiative();
      try {
        const view = await getInitiativeExecutionView(initiative);
        assert.equal(view.state, 'not_started');
        assert.equal(view.actionPlanId, null);
        assert.equal(view.totalItems, 0);
        assert.equal(view.progressPercent, 0);
      } finally {
        await deleteInitiative(initiative.id);
      }
    });
  });

  describe('syncInitiativeExecutionState — Progress/Completion (correio.md seção 19)', () => {
    test('todos os itens concluídos → Initiative vira completed automaticamente, audita como system', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'completed']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        const view = await getInitiativeExecutionView(initiative);
        assert.equal(view.state, 'completed');
        assert.equal(view.progressPercent, 100);

        const synced = await syncInitiativeExecutionState(initiative, view, null);
        assert.equal(synced.status, 'completed');
        assert.ok(synced.completedAt);
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('item ainda pendente → NÃO conclui (seção 8)', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'pending']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        const view = await getInitiativeExecutionView(initiative);
        assert.equal(view.state, 'running');

        const synced = await syncInitiativeExecutionState(initiative, view, null);
        assert.equal(synced.status, 'active');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('item bloqueado (sem nada em voo) → NÃO conclui, Initiative vira blocked automaticamente', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'blocked']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        const view = await getInitiativeExecutionView(initiative);
        assert.equal(view.state, 'blocked');

        const synced = await syncInitiativeExecutionState(initiative, view, null);
        assert.equal(synced.status, 'blocked');
        assert.equal(synced.completedAt, null, 'blocked nunca é tratado como conclusão');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('falha (sem nada mais pendente) → NÃO conclui automaticamente e NÃO cancela — Initiative continua active', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'failed']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        const view = await getInitiativeExecutionView(initiative);
        assert.equal(view.state, 'failed');

        const synced = await syncInitiativeExecutionState(initiative, view, null);
        assert.equal(synced.status, 'active', 'falha de item não é falha da Initiative (seção 9) — nunca cancela sozinha');
        assert.equal(synced.completedAt, null);
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('blocked → active: quando o bloqueio deixa de existir, Initiative é retomada automaticamente', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'completed']);
      const initiative = await insertInitiative({ status: 'blocked', actionPlanId: planId, startedAt: new Date() });
      try {
        const view = await getInitiativeExecutionView(initiative);
        const synced = await syncInitiativeExecutionState(initiative, view, null);
        // Todos completed → completed, não "active" — mas prova que o
        // ramo blocked→active não trava a Initiative em blocked para
        // sempre quando a condição de bloqueio já não existe mais.
        assert.notEqual(synced.status, 'blocked');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('sync é idempotente — chamar duas vezes seguidas não gera erro nem auditoria duplicada inconsistente', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        const view = await getInitiativeExecutionView(initiative);
        const first = await syncInitiativeExecutionState(initiative, view, null);
        const second = await syncInitiativeExecutionState(first, view, null);
        assert.equal(first.status, 'completed');
        assert.equal(second.status, 'completed');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });
  });

  describe('startInitiativeExecution — pipeline real (correio.md seção 2/3/5)', () => {
    let salesToolPermissionId: number;

    before(async () => {
      process.env.AGENT_LLM_ENABLED = 'true';
      process.env.AGENT_LLM_SHADOW_MODE = 'false';

      // Override real de agente↔tool (mesmo mecanismo do cenário
      // integrado da v2.0) força approval_required em
      // sales.get_pipeline_summary — o item fica `waiting_approval`
      // (nunca completa sozinho), então a Initiative permanece `active`
      // após o primeiro start. Necessário para os testes de
      // idempotência/concorrência: sem isso, a ação (risco `read`,
      // usuário com permissão) executaria e completaria na hora, e a
      // Initiative já teria virado `completed` automaticamente antes de
      // qualquer segunda chamada de start.
      const [salesAgent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, 'sales')).limit(1);
      const [salesTool] = await db.select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
      assert.ok(salesAgent && salesTool);
      const [toolPermission] = await db
        .select()
        .from(agentToolPermissions)
        .where(and(eq(agentToolPermissions.agentId, salesAgent.id), eq(agentToolPermissions.toolId, salesTool.id)));
      assert.ok(toolPermission);
      salesToolPermissionId = toolPermission.id;
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: true }).where(eq(agentToolPermissions.id, salesToolPermissionId));
    });

    after(async () => {
      await db.update(agentToolPermissions).set({ requiresApprovalOverride: false }).where(eq(agentToolPermissions.id, salesToolPermissionId));
    });

    test('approved → cria Action Plan real via pipeline oficial, vincula, marca active, preserva identidade do usuário', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const initiative = await insertInitiative();
      try {
        const result = await startInitiativeExecution(initiative, ceoUserId);
        assert.equal(result.created, true);
        assert.equal(result.initiative.status, 'active');
        assert.equal(result.initiative.actionPlanId, result.plan.id);
        assert.equal(result.plan.requestedBy, ceoUserId, 'identidade do usuário preservada — nunca "system"/"director"');
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0]!.decision, 'approval_required');
        assert.equal(result.items[0]!.executionStatus, 'waiting_approval');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('idempotência: chamar start de novo com a Initiative já active devolve o MESMO plano, nunca cria outro', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const initiative = await insertInitiative();
      try {
        const first = await startInitiativeExecution(initiative, ceoUserId);
        const second = await startInitiativeExecution(first.initiative, ceoUserId);

        assert.equal(second.created, false);
        assert.equal(second.plan.id, first.plan.id);
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('transição inválida (proposed) é rejeitada antes de qualquer chamada ao Planner', async () => {
      const initiative = await insertInitiative({ status: 'proposed' });
      try {
        await assert.rejects(() => startInitiativeExecution(initiative, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('usuário sem permission no tool referenciado → item nasce blocked (Policy Evaluator real, sem contorno)', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const initiative = await insertInitiative();
      try {
        const result = await startInitiativeExecution(initiative, limitedUserId);
        assert.equal(result.items[0]!.decision, 'blocked');
        assert.equal(result.items[0]!.executionStatus, 'blocked');
        // Bloqueio real nunca conclui a Initiative sozinho.
        assert.notEqual(result.initiative.status, 'completed');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('concorrência: dois starts simultâneos na mesma Initiative aprovada geram só UM Action Plan', async () => {
      setLLMProviderOverrideForTests(pipelineSummaryPlan());
      const initiative = await insertInitiative();
      try {
        const [a, b] = await Promise.all([startInitiativeExecution(initiative, ceoUserId), startInitiativeExecution(initiative, ceoUserId)]);
        const planIds = new Set([a.plan.id, b.plan.id]);
        assert.equal(planIds.size, 1, 'as duas chamadas concorrentes devem convergir para o MESMO Action Plan');
        assert.equal([a.created, b.created].filter(Boolean).length, 1, 'só uma das duas chamadas deveria ter efetivamente criado o plano');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('saneamento seção 1: NENHUMA transação fica aberta ("idle in transaction") durante a chamada ao Planner/LLM', async () => {
      // Provider com atraso artificial (800ms) — bem maior que qualquer
      // SQL do claim/vínculo, tempo de sobra para observar o estado real
      // do Postgres enquanto o "LLM" está "pensando".
      setLLMProviderOverrideForTests(delayedProvider(pipelineSummaryPlanRaw(), 800));
      const initiative = await insertInitiative();
      try {
        const startPromise = startInitiativeExecution(initiative, ceoUserId);

        // Espera o suficiente para o claim (transação curta) já ter
        // commitado, mas bem menos que o atraso do provider — a chamada
        // ainda está "dentro" do Planner/LLM neste instante.
        await new Promise((resolve) => setTimeout(resolve, 300));

        const { rows } = await database.query<{ count: string }>(
          "select count(*)::int as count from pg_stat_activity where state = 'idle in transaction' and datname = current_database()",
        );
        assert.equal(Number(rows[0]!.count), 0, 'nenhuma conexão deveria estar com uma transação aberta e ociosa enquanto o Planner/LLM "roda"');

        // A Initiative já deve estar `active` (claim commitado) mesmo
        // com o Planner ainda em andamento — prova adicional de que o
        // claim é curto e já terminou.
        const [midFlight] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id));
        assert.equal(midFlight!.status, 'active');

        await startPromise;
      } finally {
        await deleteInitiative(initiative.id);
      }
    });
  });

  describe('completeInitiativeManually — saneamento seção 2 (evidência determinística obrigatória)', () => {
    test('active + itens pendentes (running) → NÃO pode completed (409)', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'pending']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        await assert.rejects(
          () => completeInitiativeManually(initiative, ceoUserId),
          (error: unknown) => error instanceof AgentError && error.code === 'conflict',
        );
        const [reloaded] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id));
        assert.equal(reloaded!.status, 'active');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('active + waiting_approval → NÃO pode completed (409)', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'waiting_approval']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        await assert.rejects(
          () => completeInitiativeManually(initiative, ceoUserId),
          (error: unknown) => error instanceof AgentError && error.code === 'conflict',
        );
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('active + blocked → NÃO pode completed (409)', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'blocked']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        await assert.rejects(
          () => completeInitiativeManually(initiative, ceoUserId),
          (error: unknown) => error instanceof AgentError && error.code === 'conflict',
        );
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('active + failed → NÃO pode completed (409)', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'failed']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        await assert.rejects(
          () => completeInitiativeManually(initiative, ceoUserId),
          (error: unknown) => error instanceof AgentError && error.code === 'conflict',
        );
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('active + todos completed → completed é permitido, audita com o usuário real (não system)', async () => {
      const { planId } = await insertControlledPlan(ceoUserId, ['completed', 'completed']);
      const initiative = await insertInitiative({ status: 'active', actionPlanId: planId, startedAt: new Date() });
      try {
        const completed = await completeInitiativeManually(initiative, ceoUserId);
        assert.equal(completed.status, 'completed');
        assert.ok(completed.completedAt);
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('transição inválida (proposed) é rejeitada antes mesmo de calcular a execução', async () => {
      const initiative = await insertInitiative({ status: 'proposed' });
      try {
        await assert.rejects(
          () => completeInitiativeManually(initiative, ceoUserId),
          (error: unknown) => error instanceof AgentError && error.code === 'conflict',
        );
      } finally {
        await deleteInitiative(initiative.id);
      }
    });
  });

  describe('semântica real de "skipped" (saneamento seção 3) — as 2 causas reais provadas via pipeline oficial', () => {
    test('causa 1 — confidence abaixo do mínimo: decision=shadow, executionStatus=skipped, Initiative NUNCA vira blocked', async () => {
      setLLMProviderOverrideForTests(
        mockProvider({
          objective: 'Executar iniciativa com baixa confiança',
          summary: 'Ação de baixa confiança',
          actions: [
            {
              id: 'action-1',
              agent: 'sales',
              tool: 'sales.get_pipeline_summary',
              arguments: {},
              reason: 'Confiança baixa de propósito para este teste.',
              confidence: 0.1, // abaixo de AGENT_LLM_MIN_CONFIDENCE (0.8 por padrão)
            },
          ],
        }),
      );
      const initiative = await insertInitiative();
      try {
        const result = await startInitiativeExecution(initiative, ceoUserId);
        assert.equal(result.items[0]!.decision, 'shadow');
        assert.equal(result.items[0]!.executionStatus, 'skipped');
        assert.notEqual(result.initiative.status, 'blocked', 'skipped por baixa confiança nunca bloqueia a Initiative');

        const view = await getInitiativeExecutionView(result.initiative);
        assert.equal(view.shadowedItems, 1);
        assert.equal(view.blockedItems, 0);
        // Único item, terminal, não-problemático → execução concluiu.
        assert.equal(view.state, 'completed');
      } finally {
        await deleteInitiative(initiative.id);
      }
    });

    test('causa 2 — Shadow Mode global ativo + tool que muta dados: decision=shadow, executionStatus=skipped, Initiative NUNCA vira blocked', async () => {
      process.env.AGENT_LLM_SHADOW_MODE = 'true';
      try {
        setLLMProviderOverrideForTests(
          mockProvider({
            objective: 'Executar iniciativa em Shadow Mode',
            summary: 'Ação que muta dados sob Shadow Mode',
            actions: [
              {
                id: 'action-1',
                agent: 'projects',
                tool: 'projects.create_internal_task',
                arguments: { projectId: 1, title: 'Tarefa de teste' },
                reason: 'Shadow Mode ativo — não deve executar de verdade.',
                confidence: 0.95,
              },
            ],
          }),
        );
        const initiative = await insertInitiative();
        try {
          const result = await startInitiativeExecution(initiative, ceoUserId);
          assert.equal(result.items[0]!.decision, 'shadow');
          assert.equal(result.items[0]!.executionStatus, 'skipped');
          assert.notEqual(result.initiative.status, 'blocked', 'skipped por Shadow Mode nunca bloqueia a Initiative');

          const view = await getInitiativeExecutionView(result.initiative);
          assert.equal(view.shadowedItems, 1);
          assert.equal(view.blockedItems, 0);
          assert.equal(view.state, 'completed');
        } finally {
          await deleteInitiative(initiative.id);
        }
      } finally {
        process.env.AGENT_LLM_SHADOW_MODE = 'false';
      }
    });
  });
});
