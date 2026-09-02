import { eq } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorGoals } from '../../../db/schema/index.js';

import type { OperationalSignal } from '../types.js';

const NO_PROGRESS_MIN_TIME_ELAPSED_PERCENT = 25;

/**
 * Agentes v2.0 (correio.md seção 12) — extensão do mecanismo OFICIAL de
 * Operational Signal → Decision Queue (nunca uma fila especial
 * paralela): Goals ativos com `health` em `at_risk`/`critical`, prazo
 * próximo ou zero progresso viram sinais no domínio `agents` (mesma
 * convenção de `collectAgentsSignals` — saúde da própria operação do
 * Diretor, não um módulo de negócio cruzado) e entram na
 * `syncDirectorDecisionQueue()` (v1.9) já existente, sem nenhuma lógica
 * de deduplicação/priorização duplicada.
 *
 * Consulta `agent_director_goals` diretamente — legítimo pelo mesmo
 * racional já documentado em `collectors/agents.ts`: este collector vive
 * dentro do próprio módulo de agentes, não cruza para um domínio de
 * negócio.
 */
export async function collectGoalsSignals(now: Date): Promise<OperationalSignal[]> {
  const signals: OperationalSignal[] = [];

  const activeGoals = await db.select().from(agentDirectorGoals).where(eq(agentDirectorGoals.status, 'active'));

  for (const goal of activeGoals) {
    if (goal.health === 'at_risk' || goal.health === 'critical') {
      signals.push({
        id: `goal.${goal.health}:${goal.id}`,
        type: goal.health === 'critical' ? 'goal.critical' : 'goal.at_risk',
        domain: 'agents',
        severity: goal.health === 'critical' ? 'critical' : 'warning',
        title: `Goal em ${goal.health === 'critical' ? 'risco crítico' : 'risco'}: ${goal.title}`,
        description: `Progresso de ${goal.progressPercent}% — abaixo do esperado para o prazo definido (${goal.targetDate.toISOString().slice(0, 10)}).`,
        entityType: 'director_goal',
        entityId: goal.id,
        detectedAt: now,
        metadata: { progressPercent: goal.progressPercent, health: goal.health, targetDate: goal.targetDate.toISOString() },
      });
    }

    const daysRemaining = Math.ceil((goal.targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysRemaining >= 0 && daysRemaining <= 14 && goal.progressPercent < 100) {
      signals.push({
        id: `goal.deadline_near:${goal.id}`,
        type: 'goal.deadline_near',
        domain: 'agents',
        severity: daysRemaining <= 3 ? 'critical' : 'warning',
        title: `Prazo próximo: ${goal.title}`,
        description: `Faltam ${daysRemaining} dia(s) para o prazo, progresso atual ${goal.progressPercent}%.`,
        entityType: 'director_goal',
        entityId: goal.id,
        detectedAt: now,
        metadata: { daysRemaining, progressPercent: goal.progressPercent },
      });
    }

    const totalMs = Math.max(goal.targetDate.getTime() - goal.startDate.getTime(), 1);
    const elapsedMs = Math.max(now.getTime() - goal.startDate.getTime(), 0);
    const timeElapsedPercent = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

    if (goal.progressPercent === 0 && timeElapsedPercent >= NO_PROGRESS_MIN_TIME_ELAPSED_PERCENT) {
      signals.push({
        id: `goal.no_progress:${goal.id}`,
        type: 'goal.no_progress',
        domain: 'agents',
        severity: 'attention',
        title: `Sem progresso registrado: ${goal.title}`,
        description: `${timeElapsedPercent}% do prazo decorrido sem nenhum progresso registrado.`,
        entityType: 'director_goal',
        entityId: goal.id,
        detectedAt: now,
        metadata: { timeElapsedPercent },
      });
    }
  }

  return signals;
}
