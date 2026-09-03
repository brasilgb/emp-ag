import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import {
  agentActionPlanItems,
  agentActionPlans,
  agentDirectorDecisions,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutiveReviews,
  agentStrategicMemories,
  agentTools,
  agents,
  auditLogs,
  users,
} from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';
import { setLLMProviderOverrideForTests } from '../../llm/factory.js';
import { registerAllTools } from '../../tools/index.js';
import type { LLMProvider, LLMResponse } from '../../llm/types.js';
import { AgentError } from '../../errors.js';

import { generateExecutiveReview, getExecutiveReviewForInitiative } from './review-service.js';

function mockProvider(rawResponse: unknown): LLMProvider {
  return {
    name: 'mock',
    async complete(): Promise<LLMResponse> {
      return { raw: rawResponse };
    },
  };
}

function delayedProvider(rawResponse: unknown, delayMs: number): LLMProvider {
  return {
    name: 'mock-delayed',
    async complete(): Promise<LLMResponse> {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { raw: rawResponse };
    },
  };
}

function failingProvider(message: string): LLMProvider {
  return {
    name: 'mock-failing',
    async complete(): Promise<LLMResponse> {
      throw new Error(message);
    },
  };
}

/** Agentes v2.3 — o userMessage agora tem "CURRENT EVIDENCE:" + JSON + "" + "HISTORICAL ORGANIZATIONAL MEMORY:..." (ver reviews/prompt.ts:buildExecutiveReviewUserMessage). Extrai só o bloco JSON de evidência atual. */
function extractCurrentEvidenceJson(userMessage: string): unknown {
  const start = userMessage.indexOf('CURRENT EVIDENCE:') + 'CURRENT EVIDENCE:'.length;
  const end = userMessage.indexOf('\n\nHISTORICAL ORGANIZATIONAL MEMORY');
  return JSON.parse(userMessage.slice(start, end === -1 ? undefined : end).trim());
}

function reviewOutput(overrides: Record<string, unknown> = {}) {
  return {
    outcome: 'successful',
    summary: 'Resumo executivo de teste.',
    assessment: 'Avaliação detalhada de teste, baseada na evidência fornecida.',
    confidence: 0.9,
    recommendation: { type: 'none', reason: 'Nenhuma ação adicional necessária.' },
    ...overrides,
  };
}

/*
 * Agentes v2.2 (correio.md seção 24) — Executive Review: testes reais
 * cobrindo review bem-sucedida, sucesso técnico != sucesso estratégico,
 * bloqueio, shadow, imutabilidade do Goal/Initiative original, criação
 * de nova Initiative, escalation, idempotência/concorrência e ausência
 * de lock durante o LLM, seguindo o mesmo padrão de fixtures de
 * `initiatives-execution-service.test.ts` (Action Plan + Items
 * construídos diretamente, sem depender do Planner real, para controlar
 * exatamente cada execution_status).
 */
describe('Agentes v2.2 - Executive Review', () => {
  registerAllTools();
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let goalId: number;
  let salesAgentId: number;
  let salesToolId: number;

  async function insertGoal(): Promise<number> {
    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({
        title: `Goal p/ Review ${runId}-${Math.random()}`,
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
    return goal!.id;
  }

  async function insertInitiative(goal: number, overrides: Partial<typeof agentDirectorInitiatives.$inferInsert> = {}) {
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({
        goalId: goal,
        title: `Initiative Review ${runId}-${Math.random()}`,
        description: 'desc',
        domain: 'crm',
        status: 'active',
        priority: 'medium',
        rationale: 'racional',
        origin: 'manual',
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();
    return initiative!;
  }

  async function insertControlledPlan(itemStatuses: string[]): Promise<number> {
    const [plan] = await db
      .insert(agentActionPlans)
      .values({ requestedBy: ceoUserId, objective: 'Objetivo de teste controlado.', summary: 'Resumo de teste.', status: 'executing' })
      .returning();

    for (const [index, executionStatus] of itemStatuses.entries()) {
      await db.insert(agentActionPlanItems).values({
        planId: plan!.id,
        sequence: index,
        actionId: `action-${index}`,
        agent: 'sales',
        agentId: salesAgentId,
        tool: 'sales.get_pipeline_summary',
        toolId: salesToolId,
        arguments: {},
        risk: 'read',
        decision: executionStatus === 'blocked' ? 'blocked' : executionStatus === 'skipped' ? 'shadow' : 'execute',
        executionStatus,
        result: executionStatus === 'completed' ? { ok: true, summary: 'Pipeline com 5 leads ativos.' } : null,
      });
    }

    return plan!.id;
  }

  async function cleanupInitiative(id: number, planId: number | null) {
    // Decision Items de escalation são deletados explicitamente pelo
    // próprio teste que os cria (via `review.resultingDecisionId`) —
    // aqui só a review e a Initiative/Action Plan são limpos sempre.
    await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.initiativeId, id));
    await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    if (planId) {
      await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, planId));
      await db.delete(agentActionPlans).where(eq(agentActionPlans.id, planId));
    }
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [sale] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, 'sales')).limit(1);
    const [tool] = await db.select({ id: agentTools.id }).from(agentTools).where(eq(agentTools.handler, 'sales.get_pipeline_summary')).limit(1);
    assert.ok(sale && tool);
    salesAgentId = sale.id;
    salesToolId = tool.id;

    process.env.AGENT_LLM_ENABLED = 'true';

    goalId = await insertGoal();
  });

  after(async () => {
    setLLMProviderOverrideForTests(null);
    delete process.env.AGENT_LLM_ENABLED;
    delete process.env.AGENT_LLM_SHADOW_MODE;

    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  test('Initiative sem execução elegível (running) → gerar review é rejeitado (409), nada é persistido', async () => {
    const planId = await insertControlledPlan(['pending']);
    const initiative = await insertInitiative(goalId, { actionPlanId: planId, startedAt: new Date() });
    try {
      await assert.rejects(
        () => generateExecutiveReview(initiative, ceoUserId),
        (error: unknown) => error instanceof AgentError && error.code === 'conflict',
      );
      const [row] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.initiativeId, initiative.id));
      assert.equal(row, undefined);
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('Initiative sem actionPlanId → rejeitado (409)', async () => {
    const initiative = await insertInitiative(goalId, { status: 'proposed' });
    try {
      await assert.rejects(
        () => generateExecutiveReview(initiative, ceoUserId),
        (error: unknown) => error instanceof AgentError && error.code === 'conflict',
      );
    } finally {
      await cleanupInitiative(initiative.id, null);
    }
  });

  test('review bem-sucedida: Initiative completed com evidência positiva → review criada, outcome successful, persistida corretamente', async () => {
    const planId = await insertControlledPlan(['completed', 'completed']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(mockProvider(reviewOutput({ outcome: 'successful' })));
      const { review, created } = await generateExecutiveReview(initiative, ceoUserId);

      assert.equal(created, true);
      assert.equal(review.status, 'completed');
      assert.equal(review.outcome, 'successful');
      assert.equal(review.goalId, goalId);
      assert.equal(review.initiativeId, initiative.id);
      assert.equal(review.actionPlanId, planId);
      assert.ok(review.evidence, 'evidência deve estar persistida');
      assert.ok(review.summary);
      assert.ok(review.assessment);

      const [persisted] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
      assert.ok(persisted);
      assert.equal(persisted.outcome, 'successful');

      const read = await getExecutiveReviewForInitiative(initiative);
      assert.equal(read?.id, review.id);
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('sucesso técnico ≠ sucesso estratégico: Action Plan 100% completed, mas review indica objetivo não atingido', async () => {
    const planId = await insertControlledPlan(['completed', 'completed']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(
        mockProvider(
          reviewOutput({
            outcome: 'unsuccessful',
            assessment: 'Todas as ações técnicas foram concluídas, mas o objetivo estratégico do Goal não avançou.',
            recommendation: { type: 'adjust', reason: 'A estratégia atual não está gerando o resultado esperado.' },
          }),
        ),
      );
      const { review } = await generateExecutiveReview(initiative, ceoUserId);

      assert.equal(review.outcome, 'unsuccessful', 'outcome estratégico é decidido pelo LLM, independente do sucesso técnico');
      assert.equal(review.recommendationType, 'adjust');

      // Prova que a Initiative continua tecnicamente "completed" — a
      // review nunca reescreve o status técnico da Initiative.
      const [reloadedInitiative] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id));
      assert.equal(reloadedInitiative!.status, 'completed');
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('Initiative bloqueada: outcome coerente, nunca classificado como sucesso', async () => {
    const planId = await insertControlledPlan(['completed', 'blocked']);
    const initiative = await insertInitiative(goalId, { status: 'blocked', actionPlanId: planId, startedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(
        mockProvider(
          reviewOutput({
            outcome: 'blocked',
            assessment: 'A execução foi interrompida por um impedimento estrutural real (bloqueio de policy).',
            recommendation: { type: 'escalate', reason: 'Impedimento requer decisão do CEO para prosseguir.' },
          }),
        ),
      );
      const { review } = await generateExecutiveReview(initiative, ceoUserId);

      assert.equal(review.outcome, 'blocked');
      assert.notEqual(review.outcome, 'successful');
      assert.notEqual(review.outcome, 'partially_successful');
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('skipped/shadow: itens shadow não significam automaticamente falha estratégica — evidência é avaliada normalmente', async () => {
    const planId = await insertControlledPlan(['completed', 'skipped']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      let capturedContext: unknown = null;
      setLLMProviderOverrideForTests({
        name: 'mock-capture',
        async complete(request): Promise<LLMResponse> {
          capturedContext = extractCurrentEvidenceJson(request.userMessage);
          return { raw: reviewOutput({ outcome: 'successful' }) };
        },
      });

      const { review } = await generateExecutiveReview(initiative, ceoUserId);
      assert.equal(review.outcome, 'successful');

      const context = capturedContext as { execution: { shadowedItems: number; state: string } };
      assert.equal(context.execution.shadowedItems, 1);
      assert.equal(context.execution.state, 'completed', 'shadow terminal e não-problemático — execução real chega a completed');
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('review não altera Goal nem Initiative originais', async () => {
    const planId = await insertControlledPlan(['completed']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      const [goalBefore] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));
      const [initiativeBefore] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id));

      setLLMProviderOverrideForTests(mockProvider(reviewOutput({ outcome: 'unsuccessful', recommendation: { type: 'adjust', reason: 'x' } })));
      await generateExecutiveReview(initiative, ceoUserId);

      const [goalAfter] = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));
      const [initiativeAfter] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, initiative.id));

      assert.equal(goalAfter!.title, goalBefore!.title);
      assert.equal(goalAfter!.description, goalBefore!.description);
      assert.equal(goalAfter!.status, goalBefore!.status);
      assert.equal(goalAfter!.updatedAt.getTime(), goalBefore!.updatedAt.getTime(), 'Goal nunca é escrito por uma Executive Review');

      assert.equal(initiativeAfter!.title, initiativeBefore!.title);
      assert.equal(initiativeAfter!.rationale, initiativeBefore!.rationale);
      assert.equal(initiativeAfter!.status, initiativeBefore!.status);
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('recomendação new_initiative: cria só uma proposta pelo pipeline oficial — nunca Action Plan, nunca tool, nunca pula aprovação', async () => {
    const planId = await insertControlledPlan(['completed']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(
        mockProvider(
          reviewOutput({
            outcome: 'partially_successful',
            recommendation: { type: 'new_initiative', reason: 'Uma nova linha de atuação é necessária.', proposedGoal: 'Reforçar prospecção ativa' },
          }),
        ),
      );
      const { review } = await generateExecutiveReview(initiative, ceoUserId);

      assert.equal(review.recommendationType, 'new_initiative');
      assert.ok(review.resultingInitiativeId, 'deveria vincular a nova Initiative criada');

      const [created] = await db.select().from(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, review.resultingInitiativeId!));
      assert.ok(created);
      assert.equal(created.status, 'proposed', 'nasce proposed — precisa de aprovação humana, nunca pula o ciclo de vida oficial');
      assert.equal(created.origin, 'director_recommendation');
      assert.equal(created.actionPlanId, null, 'nunca cria Action Plan diretamente a partir da recomendação');

      await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, created.id));
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('recomendação escalate: gera Decision Item pelo mecanismo já existente (Director Decision Queue), nenhuma decisão auto-aprovada', async () => {
    const planId = await insertControlledPlan(['completed', 'blocked']);
    const initiative = await insertInitiative(goalId, { status: 'blocked', actionPlanId: planId, startedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(
        mockProvider(reviewOutput({ outcome: 'blocked', recommendation: { type: 'escalate', reason: 'Decisão do CEO necessária.' } })),
      );
      const { review } = await generateExecutiveReview(initiative, ceoUserId);

      assert.equal(review.recommendationType, 'escalate');
      assert.ok(review.resultingDecisionId);

      const [decision] = await db.select().from(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, review.resultingDecisionId!));
      assert.ok(decision, 'deveria reutilizar a Director Decision Queue existente, não uma entidade paralela');
      assert.equal(decision.status, 'open', 'nenhuma decisão é auto-aprovada — fica aberta aguardando o CEO');
      assert.equal(decision.requiresHumanAttention, true);
      assert.equal(decision.signalType, 'director.executive_review_escalation');

      await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, decision.id));
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('idempotência: duas chamadas concorrentes → exatamente uma review canônica, nenhuma duplicação', async () => {
    const planId = await insertControlledPlan(['completed']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(delayedProvider(reviewOutput({ outcome: 'successful' }), 200));
      const [a, b] = await Promise.all([generateExecutiveReview(initiative, ceoUserId), generateExecutiveReview(initiative, ceoUserId)]);

      assert.equal(a.review.id, b.review.id, 'as duas chamadas concorrentes devem convergir para a MESMA review');
      assert.equal([a.created, b.created].filter(Boolean).length, 1, 'só uma das duas chamadas deveria ter efetivamente gerado a review');

      const rows = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.actionPlanId, planId));
      assert.equal(rows.length, 1, 'nenhuma review duplicada persistida');
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('ausência de lock durante o LLM: nenhuma transação fica "idle in transaction" durante a chamada ao provider', async () => {
    const planId = await insertControlledPlan(['completed']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(delayedProvider(reviewOutput({ outcome: 'successful' }), 800));
      const genPromise = generateExecutiveReview(initiative, ceoUserId);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const { rows } = await database.query<{ count: string }>(
        "select count(*)::int as count from pg_stat_activity where state = 'idle in transaction' and datname = current_database()",
      );
      assert.equal(Number(rows[0]!.count), 0, 'nenhuma conexão deveria estar com transação aberta e ociosa enquanto o Reviewer/LLM "roda"');

      // O claim (draft) já deve existir mesmo com o LLM ainda em andamento.
      const [draft] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.actionPlanId, planId));
      assert.equal(draft!.status, 'draft');

      await genPromise;
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  test('falha do provider: review não fica presa em draft — retry seguro cria a review normalmente', async () => {
    const planId = await insertControlledPlan(['completed']);
    const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
    try {
      setLLMProviderOverrideForTests(failingProvider('Provider indisponível (teste).'));
      await assert.rejects(() => generateExecutiveReview(initiative, ceoUserId));

      const [afterFailure] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.actionPlanId, planId));
      assert.equal(afterFailure, undefined, 'a linha draft deveria ter sido revertida (deletada), nunca presa para sempre');

      setLLMProviderOverrideForTests(mockProvider(reviewOutput({ outcome: 'successful' })));
      const { review, created } = await generateExecutiveReview(initiative, ceoUserId);
      assert.equal(created, true);
      assert.equal(review.status, 'completed');
    } finally {
      await cleanupInitiative(initiative.id, planId);
    }
  });

  describe('Agentes v2.3 (correio.md seção 11/16/20) — Strategic Memory injetada como contexto histórico', () => {
    test('16: CURRENT EVIDENCE e HISTORICAL ORGANIZATIONAL MEMORY aparecem separadas no prompt; 19: memoryIdsUsed fica auditável', async () => {
      const [historicalMemory] = await db
        .insert(agentStrategicMemories)
        .values({
          memoryType: 'initiative_outcome',
          domain: 'crm',
          title: 'Aprendizado histórico de teste',
          summary: 'resumo',
          lesson: 'Campanhas deste tipo tendem a demorar mais que o esperado.',
          confidence: '0.750',
          importance: 'high',
          tags: [],
          sourceGoalId: goalId,
          sourceInitiativeId: (await insertInitiative(goalId)).id,
          status: 'active',
          evidence: {},
        })
        .returning();

      const planId = await insertControlledPlan(['completed']);
      const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
      try {
        let capturedUserMessage = '';
        setLLMProviderOverrideForTests({
          name: 'mock-capture-memory',
          async complete(request): Promise<LLMResponse> {
            capturedUserMessage = request.userMessage;
            return { raw: reviewOutput({ outcome: 'successful' }) };
          },
        });

        const { review } = await generateExecutiveReview(initiative, ceoUserId);
        assert.equal(review.outcome, 'successful');

        // Seção 16: seções claramente separadas, nunca misturadas num
        // único blob — a evidência atual vem primeiro, a memória
        // histórica depois, com o texto de precedência explícito.
        const currentIndex = capturedUserMessage.indexOf('CURRENT EVIDENCE');
        const historicalIndex = capturedUserMessage.indexOf('HISTORICAL ORGANIZATIONAL MEMORY');
        assert.ok(currentIndex >= 0 && historicalIndex >= 0, 'ambas as seções deveriam estar presentes no prompt');
        assert.ok(currentIndex < historicalIndex, 'CURRENT EVIDENCE deveria vir antes de HISTORICAL ORGANIZATIONAL MEMORY');
        assert.ok(capturedUserMessage.includes('Campanhas deste tipo tendem a demorar mais que o esperado.'), 'a lição da memória histórica deveria estar no prompt');
        assert.ok(capturedUserMessage.includes('precedência'), 'instrução explícita de precedência da evidência atual deveria estar presente');

        // Seção 19: IDs das memórias usadas ficam auditáveis.
        const [auditRow] = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.action, 'agents.director.memory.reused'), eq(auditLogs.entityType, 'agent_executive_review'), eq(auditLogs.entityId, String(review.id))));
        assert.ok(auditRow, 'deveria existir um registro de auditoria de reuso de memória para esta review');
        const metadata = auditRow.metadata as { memoryIdsUsed: number[] };
        assert.ok(metadata.memoryIdsUsed.includes(historicalMemory!.id));
      } finally {
        await cleanupInitiative(initiative.id, planId);
        await db.delete(agentStrategicMemories).where(eq(agentStrategicMemories.id, historicalMemory!.id));
      }
    });

    test('memória arquivada nunca entra no prompt de uma nova review', async () => {
      const initiativeForMemory = await insertInitiative(goalId);
      const [archivedMemory] = await db
        .insert(agentStrategicMemories)
        .values({
          memoryType: 'initiative_outcome',
          domain: 'crm',
          title: 'Memória arquivada — nunca deveria aparecer',
          lesson: 'Texto que nunca deveria ir ao prompt.',
          confidence: '0.900',
          importance: 'high',
          tags: [],
          sourceGoalId: goalId,
          sourceInitiativeId: initiativeForMemory.id,
          status: 'archived',
          evidence: {},
        })
        .returning();

      const planId = await insertControlledPlan(['completed']);
      const initiative = await insertInitiative(goalId, { status: 'completed', actionPlanId: planId, startedAt: new Date(), completedAt: new Date() });
      try {
        let capturedUserMessage = '';
        setLLMProviderOverrideForTests({
          name: 'mock-capture-archived',
          async complete(request): Promise<LLMResponse> {
            capturedUserMessage = request.userMessage;
            return { raw: reviewOutput({ outcome: 'successful' }) };
          },
        });

        await generateExecutiveReview(initiative, ceoUserId);
        assert.ok(!capturedUserMessage.includes('Texto que nunca deveria ir ao prompt.'), 'memória arquivada nunca deveria entrar no contexto');
      } finally {
        await cleanupInitiative(initiative.id, planId);
        await db.delete(agentStrategicMemories).where(eq(agentStrategicMemories.id, archivedMemory!.id));
      }
    });
  });
});
