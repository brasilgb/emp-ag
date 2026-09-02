import { eq, inArray, isNotNull } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoals, agentDirectorInitiatives } from '../../../db/schema/index.js';

import { evaluateDirectorGoal } from './evaluation-engine.js';
import { HEALTH_RANK, RECOMMENDATION_MIN_HEALTH_RANK } from './thresholds.js';
import type { GoalHealth } from './types.js';

export interface GoalReviewSummary {
  evaluated: number;
  recommendationsCreated: number;
  /** Reincidência (correio.md — saneamento seção 5): recomendação anterior estava encerrada e foi reaberta, nunca duplicada. */
  recommendationsReopened: number;
  unchanged: number;
  errors: { goalId: number; message: string }[];
}

/**
 * Reincidência de recomendação (correio.md — saneamento seção 5):
 * `recommendationKey = goal-health:<goalId>:<health>` é estável — a
 * MESMA condição (mesmo Goal, mesmo health) sempre mapeia para a MESMA
 * chave, para sempre. Decisão explícita: **reutiliza a Initiative
 * anterior** em vez de criar uma nova a cada reincidência — mesmo
 * princípio já usado no reopen de Decision Item da v1.9
 * (`decisions/sync-service.ts`: "'resolved'/'dismissed' são os únicos
 * dois estados que a reocorrência reabre").
 *
 * Comportamento exato:
 * - Nenhuma Initiative com esta chave ainda → cria nova (`proposed`).
 * - Já existe uma Initiative com esta chave e ela está ABERTA
 *   (`proposed`/`approved`/`active`/`blocked`) → não faz nada; já está
 *   sendo acompanhada, não duplica.
 * - Já existe uma Initiative com esta chave e ela está TERMINAL
 *   (`completed`/`cancelled` — ou seja, o ciclo anterior de risco já
 *   foi tratado ou descartado) → REABRE a mesma linha: volta para
 *   `proposed`, limpa `cancelledAt`/`cancellationReason`/`completedAt`/
 *   `actionPlanId`/`startedAt` (o Action Plan do ciclo anterior não se
 *   aplica ao novo episódio de risco) e atualiza o texto para o
 *   contexto atual.
 *
 * at_risk → on_track → at_risk: a primeira vez cria a Initiative; se
 * ela foi concluída ou cancelada antes da recuperação, a reincidência
 * REABRE a mesma linha (não cria uma segunda). Se ela ainda estava
 * aberta quando o Goal recuperou (ninguém tratou), a "recuperação" não
 * fecha a Initiative sozinha — ela continua aberta e a reincidência não
 * muda nada (já está sendo acompanhada). Sem escalation automática:
 * apenas 1 linha por (goal, health) para sempre, controlada
 * inteiramente pelo estado real da própria Initiative.
 */
// Exportado para o teste de consistência em initiatives-lifecycle.test.ts
// — este conjunto precisa ser EXATAMENTE igual aos estados de origem de
// `completed → proposed`/`cancelled → proposed` em
// initiatives-lifecycle.ts (única fonte de verdade de lifecycle,
// correio.md v2.1 seção 1).
export const REOPENABLE_INITIATIVE_STATUSES = ['completed', 'cancelled'] as const;

const RECOMMENDATION_TEMPLATES: Record<'at_risk' | 'critical', (title: string) => { title: string; rationale: string }> = {
  at_risk: (title) => ({
    title: `Reforçar esforço em: ${title}`,
    rationale:
      'O progresso está abaixo do esperado em relação ao tempo decorrido até o prazo — recomendado avaliar uma linha de atuação adicional para recuperar o ritmo.',
  }),
  critical: (title) => ({
    title: `Ação urgente necessária: ${title}`,
    rationale:
      'O desvio entre progresso e tempo decorrido é severo (ou o prazo já venceu sem conclusão) — recomendado priorizar uma iniciativa imediata.',
  }),
};

function healthRank(health: GoalHealth): number {
  return HEALTH_RANK.indexOf(health as (typeof HEALTH_RANK)[number]);
}

/**
 * Agentes v2.0 (correio.md seção 11) — avalia Goals ativos e recomenda
 * Initiative quando aplicável. Deduplicação/reincidência: ver o
 * docblock de `REOPENABLE_INITIATIVE_STATUSES` acima — create-or-reopen
 * via `onConflictDoUpdate` condicional, nunca find-then-insert
 * desprotegido (mesma exigência de concorrência da v1.9 seção 30). Uma
 * mudança de `at_risk` para `critical` gera uma NOVA recomendação
 * (chave diferente) — degradação real merece nova atenção; melhora não
 * gera recomendação nenhuma.
 */
export async function reviewDirectorGoals(now: Date = new Date()): Promise<GoalReviewSummary> {
  const activeGoals = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.status, 'active'));

  const summary: GoalReviewSummary = { evaluated: 0, recommendationsCreated: 0, recommendationsReopened: 0, unchanged: 0, errors: [] };

  for (const goal of activeGoals) {
    try {
      const result = await evaluateDirectorGoal(goal.id, { now });
      if (!result) continue;
      summary.evaluated += 1;

      const { health, goal: evaluatedGoal } = { health: result.evaluation.health, goal: result.goal };
      if (healthRank(health) < RECOMMENDATION_MIN_HEALTH_RANK) {
        summary.unchanged += 1;
        continue;
      }

      const recommendation = RECOMMENDATION_TEMPLATES[health as 'at_risk' | 'critical'](evaluatedGoal.title);
      const recommendationKey = `goal-health:${goal.id}:${health}`;

      const description = `Recomendação automática do Director Goal Review para o Goal "${evaluatedGoal.title}" (health=${health}).`;

      // create-or-reopen atômico (correio.md — saneamento seção 5):
      // índice único PARCIAL (WHERE recommendation_key IS NOT NULL, ver
      // agent-director-initiatives.ts) como arbiter — `targetWhere`
      // repete o predicado do índice (exigência do Postgres para inferir
      // um índice parcial). `setWhere` faz o UPDATE só se aplicar de
      // fato quando a linha existente já está TERMINAL — do contrário
      // vira um no-op equivalente ao antigo DO NOTHING (nunca sobrescreve
      // uma Initiative em andamento). Nunca find-then-insert desprotegido
      // (mesma exigência de concorrência da v1.9 seção 30).
      const upserted = await db
        .insert(agentDirectorInitiatives)
        .values({
          goalId: goal.id,
          title: recommendation.title,
          description,
          domain: evaluatedGoal.domain,
          status: 'proposed',
          priority: health === 'critical' ? 'critical' : 'high',
          rationale: recommendation.rationale,
          origin: 'director_recommendation',
          recommendationKey,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [agentDirectorInitiatives.goalId, agentDirectorInitiatives.recommendationKey],
          targetWhere: isNotNull(agentDirectorInitiatives.recommendationKey),
          setWhere: inArray(agentDirectorInitiatives.status, [...REOPENABLE_INITIATIVE_STATUSES]),
          set: {
            status: 'proposed',
            title: recommendation.title,
            description,
            rationale: recommendation.rationale,
            priority: health === 'critical' ? 'critical' : 'high',
            cancelledAt: null,
            cancellationReason: null,
            completedAt: null,
            actionPlanId: null,
            startedAt: null,
            updatedAt: now,
          },
        })
        .returning({ id: agentDirectorInitiatives.id, createdAt: agentDirectorInitiatives.createdAt, updatedAt: agentDirectorInitiatives.updatedAt });

      // `createdAt === updatedAt` só é verdade no INSERT original (ambos
      // recebem `now` na mesma values()) — um UPDATE (reopen) sempre
      // muda só `updatedAt`, nunca `createdAt`. Distingue create de
      // reopen sem uma segunda query.
      const row = upserted[0];
      if (!row) {
        // setWhere avaliou falso (linha existente ainda aberta) — no-op real.
        summary.unchanged += 1;
      } else if (row.createdAt.getTime() === row.updatedAt.getTime()) {
        summary.recommendationsCreated += 1;
      } else {
        summary.recommendationsReopened += 1;
      }
    } catch (error) {
      summary.errors.push({ goalId: goal.id, message: error instanceof Error ? error.message : 'Falha desconhecida ao avaliar Goal.' });
    }
  }

  return summary;
}
