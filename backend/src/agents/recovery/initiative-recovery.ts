import { and, eq, isNull, lt } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentActionPlans, agentDirectorInitiatives } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';

import { escalateToManualAttention } from './manual-attention.js';
import type { RecoveryAdapter, RecoveryItemResult, StaleCandidate } from './types.js';

const ACTIVE_NO_PLAN = 'active_no_plan';
const ACTIVE_PLAN_STUCK_EVALUATING = 'active_plan_stuck_evaluating';

/**
 * Agentes v2.4 (correio.md seção 7) — recovery para `Initiative` presa
 * em `active`. Revisão do fluxo real de `startInitiativeExecution`
 * (v2.1, `initiatives-execution-service.ts`) antes de implementar
 * (seção 7: "não inventar comportamento sem ler o fluxo real"):
 *
 * ```text
 * transação curta: claim (status 'approved' → 'active')  ← commit AQUI
 * fora de transação: Planner (planEvaluateAndPersistActionPlan) + Executor
 * transação curta: vincula action_plan_id
 * ```
 *
 * Duas janelas reais onde um crash deixa `Initiative.status='active'`
 * órfã:
 *
 * ### Caso B (implementado): crash ANTES do Planner terminar de criar o Action Plan
 * `status='active'` + `action_plan_id IS NULL` — o mesmo estado que o
 * PRÓPRIO `catch` de `startInitiativeExecution` reverteria se tivesse
 * tido a chance de rodar. Recovery faz exatamente essa mesma
 * compensação (`status → 'approved'`), nunca cria Action Plan (seção 7:
 * "não criar plano diretamente dentro do recovery") — só devolve a
 * Initiative a um estado do qual o pipeline OFICIAL
 * (`startInitiativeExecution`, chamado de novo por `POST .../propose`)
 * pode retomar normalmente.
 *
 * ### Caso C (implementado): crash DURANTE a avaliação do Action Plan pelo Policy Evaluator
 * `status='active'` + `action_plan_id` já setado, mas o Action Plan
 * vinculado ficou `status='evaluating'` (o valor inicial, seção
 * `create-action-plan.ts` — só avança quando TODOS os itens são
 * avaliados e o executor roda) por tempo além do threshold. Diferente
 * do Caso B, aqui existem dois registros reais (Initiative + Action
 * Plan) em estados parcialmente inconsistentes — decidir sozinho "o que
 * fazer" exigiria adivinhar quais itens já foram avaliados e quais não
 * (seção 7: "não tentar adivinhar"). Escalado para `manual_attention`
 * (Director Decision Queue, seção 13) — nenhuma linha é tocada.
 *
 * ### Caso A (seção 7, não precisa de código): Initiative `active` com
 * Action Plan já vinculado e em status normal (evaluating não-travado,
 * executing, completed, etc.) simplesmente NÃO É stale por esta própria
 * definição de detecção — o `check-on-read` já existente
 * (`syncInitiativeExecutionState`, chamado a cada `GET .../execution`)
 * já reconcilia o status real da Initiative sem nenhuma ajuda do
 * recovery. `detectStale` abaixo exclui esses casos explicitamente (não
 * aparecem na lista de candidatos).
 *
 * Limitação real conhecida e documentada no relatório de entrega: um
 * crash EXATAMENTE entre `executeActionPlan()` terminar e a transação
 * curta final de vínculo (`action_plan_id`) roda deixa
 * `status='active'`+`action_plan_id IS NULL` indistinguível do Caso B —
 * o Action Plan já criado/executado fica orfão (nunca vinculado). Esta
 * versão trata esse caso como Caso B (reverte a Initiative para
 * `approved`, permitindo nova tentativa) — o Action Plan órfão nunca é
 * adivinhado/religado automaticamente (isso seria "adivinhar", proibido
 * pela seção 7).
 */
export const initiativeRecoveryAdapter: RecoveryAdapter = {
  workflowType: 'initiative',

  async detectStale(thresholdSeconds) {
    const staleBefore = new Date(Date.now() - thresholdSeconds * 1000);

    const activeInitiatives = await db
      .select()
      .from(agentDirectorInitiatives)
      .where(and(eq(agentDirectorInitiatives.status, 'active'), lt(agentDirectorInitiatives.updatedAt, staleBefore)));

    const candidates: StaleCandidate[] = [];

    for (const initiative of activeInitiatives) {
      const ageSeconds = Math.floor((Date.now() - initiative.updatedAt.getTime()) / 1000);

      if (!initiative.actionPlanId) {
        candidates.push({
          workflowType: 'initiative',
          entityId: initiative.id,
          previousState: ACTIVE_NO_PLAN,
          ageSeconds,
          problem: `Initiative #${initiative.id} está "active" sem Action Plan vinculado há mais de ${thresholdSeconds}s — claim provavelmente órfão (processo morreu antes de vincular o Action Plan).`,
        });
        continue;
      }

      const [plan] = await db.select().from(agentActionPlans).where(eq(agentActionPlans.id, initiative.actionPlanId)).limit(1);

      // Caso A: plano existe e está num status normal — NÃO é stale,
      // não entra na lista (o check-on-read já cuida do resto).
      if (!plan || plan.status !== 'evaluating') continue;

      candidates.push({
        workflowType: 'initiative',
        entityId: initiative.id,
        previousState: ACTIVE_PLAN_STUCK_EVALUATING,
        ageSeconds,
        problem: `Initiative #${initiative.id} está "active" com Action Plan #${plan.id} preso em "evaluating" há mais de ${thresholdSeconds}s — evidência contraditória (avaliação do Policy Evaluator não terminou), requer atenção humana.`,
      });
    }

    return candidates;
  },

  async reconcile(candidate, params): Promise<RecoveryItemResult> {
    const timestamp = new Date().toISOString();

    if (candidate.previousState === ACTIVE_PLAN_STUCK_EVALUATING) {
      if (params.dryRun) {
        return {
          workflowType: 'initiative',
          entityId: candidate.entityId,
          previousState: candidate.previousState,
          result: 'manual_attention',
          reason: 'dry_run: escalaria para a Director Decision Queue — evidência contraditória, recovery nunca adivinha.',
          timestamp,
        };
      }

      const decision = await escalateToManualAttention({ workflowType: 'initiative', entityId: candidate.entityId, problem: candidate.problem });

      await audit({
        userId: params.actorUserId,
        actorType: params.actorUserId ? 'user' : 'system',
        actorId: params.actorUserId ? String(params.actorUserId) : null,
        action: 'agents.recovery.manual_attention',
        entityType: 'agent_director_initiative',
        entityId: String(candidate.entityId),
        metadata: { workflowType: 'initiative', previousState: candidate.previousState, ageSeconds: candidate.ageSeconds, decisionId: decision.id },
      });

      return {
        workflowType: 'initiative',
        entityId: candidate.entityId,
        previousState: candidate.previousState,
        result: 'manual_attention',
        reason: `Evidência contraditória — escalado para Decision Item #${decision.id} na Director Decision Queue.`,
        timestamp,
      };
    }

    // ACTIVE_NO_PLAN (Caso B).
    const staleBefore = new Date(Date.now() - params.thresholdSeconds * 1000);

    if (params.dryRun) {
      return {
        workflowType: 'initiative',
        entityId: candidate.entityId,
        previousState: candidate.previousState,
        result: 'reverted',
        reason: 'dry_run: reverteria o status para "approved" (claim órfão sem Action Plan), permitindo novo retry via POST .../propose.',
        timestamp,
      };
    }

    // Predicado forte (seção 23) — nunca um UPDATE cego: id + status
    // ainda 'active' + action_plan_id ainda NULL + updated_at anterior
    // ao threshold. `RETURNING` prova atomicamente que ESTA chamada
    // venceu a corrida (mesmo padrão de `startInitiativeExecution`).
    const updated = await db
      .update(agentDirectorInitiatives)
      .set({ status: 'approved', startedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(agentDirectorInitiatives.id, candidate.entityId),
          eq(agentDirectorInitiatives.status, 'active'),
          isNull(agentDirectorInitiatives.actionPlanId),
          lt(agentDirectorInitiatives.updatedAt, staleBefore),
        ),
      )
      .returning({ id: agentDirectorInitiatives.id });

    if (updated.length === 0) {
      return {
        workflowType: 'initiative',
        entityId: candidate.entityId,
        previousState: candidate.previousState,
        result: 'skipped',
        reason: 'Já não estava mais stale no momento da reconciliação (Action Plan vinculado nesse meio-tempo, status mudou, ou já reconciliada por outro processo).',
        timestamp,
      };
    }

    await audit({
      userId: params.actorUserId,
      actorType: params.actorUserId ? 'user' : 'system',
      actorId: params.actorUserId ? String(params.actorUserId) : null,
      action: 'agents.recovery.reconciled',
      entityType: 'agent_director_initiative',
      entityId: String(candidate.entityId),
      metadata: { workflowType: 'initiative', previousState: candidate.previousState, ageSeconds: candidate.ageSeconds, result: 'reverted', reason: 'stale_claim_no_action_plan' },
    });

    return {
      workflowType: 'initiative',
      entityId: candidate.entityId,
      previousState: candidate.previousState,
      result: 'reverted',
      reason: 'Claim órfão sem Action Plan revertido para "approved" — nova tentativa pode ser feita via POST .../propose (pipeline oficial).',
      timestamp,
    };
  },
};
