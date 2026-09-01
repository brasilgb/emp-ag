import { and, eq, lte } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentJobs } from '../../db/schema/index.js';
import { runAgentJob } from './job-runner.js';

/**
 * Scheduler interno simples (correio.md v1.3 seção 20). Só identifica
 * Jobs `schedule` vencidos e chama runAgentJob — nunca executa business
 * tool, nunca chama o provider de LLM diretamente (isso é
 * responsabilidade exclusiva de agents/orchestration/create-action-plan.ts,
 * chamado por dentro de runAgentJob) e nunca aprova nada. Arquitetura
 * pronta para futuramente mover para n8n/worker dedicado sem reescrever
 * esta função — pollDueJobs() já é standalone e idempotente por
 * construção (o lock+budget dentro de runAgentJob evita runs duplicados
 * mesmo que o poll dispare duas vezes para o mesmo Job).
 */
export async function pollDueJobs(now: Date = new Date()): Promise<number> {
  const dueJobs = await db
    .select({ id: agentJobs.id })
    .from(agentJobs)
    .where(and(eq(agentJobs.status, 'active'), eq(agentJobs.triggerType, 'schedule'), lte(agentJobs.nextRunAt, now)));

  let triggered = 0;

  for (const job of dueJobs) {
    try {
      const result = await runAgentJob(job.id, { type: 'schedule' });

      if (result.ok) {
        triggered += 1;
      }
    } catch (error) {
      // Nunca deixa a falha de um Job travar o poll dos demais.
      // eslint-disable-next-line no-console
      console.error(`[scheduler] falha ao rodar Job #${job.id}:`, error);
    }
  }

  return triggered;
}

let schedulerInterval: NodeJS.Timeout | null = null;

// Chamada só por server.ts (nunca por app.ts/buildApp, usado pelos
// testes) — mesmo princípio de isolamento de AGENT_LLM_ENABLED.
export function startJobScheduler(intervalMs: number): void {
  if (schedulerInterval) {
    return;
  }

  schedulerInterval = setInterval(() => {
    pollDueJobs().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[scheduler] falha inesperada no poll:', error);
    });
  }, intervalMs);

  schedulerInterval.unref?.();
}

export function stopJobScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
