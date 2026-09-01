import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentJobs } from '../../db/schema/index.js';
import { env } from '../../config/env.js';
import { audit } from '../../services/audit.js';

export type AutonomousRunOutcome = 'completed' | 'failed';

/**
 * Metade "finalização" do Circuit Breaker (correio.md seção 9) — o
 * Autonomy Guard (agents/autonomy/guard.ts) decide se uma tentativa passa;
 * esta função reage ao resultado de um Run já terminado. Chamada só por
 * agents/jobs/job-runner.ts (runAgentJob, no branch de timeout, e
 * syncJobRunStatus, que cobre tanto o fim normal quanto o fluxo de
 * aprovação assíncrona) — sempre com `triggerType !== 'manual'`: o
 * chamador já filtra isso antes de invocar (execução manual nunca abre/
 * fecha o circuito autônomo, requisito explícito do correio.md).
 *
 * Semântica documentada (decisão, seção 9): só 'completed'
 * (sucesso)/'failed' (falha) movem o circuito — 'partial'/'blocked'/
 * 'cancelled' não são um veredito limpo e ficam neutros. Sucesso em
 * `closed` zera o contador de falhas (estratégia "reset on success",
 * mais simples e determinística entre as opções que a seção 9 permite).
 * Sucesso em `half_open` fecha o circuito. Falha em qualquer estado
 * (closed acumulando até o threshold, ou half_open) reabre/mantém aberto
 * e reinicia o cooldown.
 */
export async function recordAutonomousOutcome(jobId: number, outcome: AutonomousRunOutcome): Promise<void> {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(agentJobs).where(eq(agentJobs.id, jobId)).for('update');

    if (!job) {
      return;
    }

    if (outcome === 'completed') {
      const wasHalfOpen = job.circuitState === 'half_open';

      await tx
        .update(agentJobs)
        .set({ circuitState: 'closed', circuitFailureCount: 0, circuitOpenedAt: null })
        .where(eq(agentJobs.id, jobId));

      if (wasHalfOpen) {
        await audit({
          userId: null,
          actorType: 'system',
          actorId: null,
          action: 'agent_autonomy.circuit_closed',
          entityType: 'agent_job',
          entityId: String(jobId),
          metadata: { previousState: job.circuitState },
        });
      }

      return;
    }

    // outcome === 'failed'
    if (job.circuitState === 'half_open') {
      await tx
        .update(agentJobs)
        .set({ circuitState: 'open', circuitOpenedAt: new Date() })
        .where(eq(agentJobs.id, jobId));

      await audit({
        userId: null,
        actorType: 'system',
        actorId: null,
        action: 'agent_autonomy.circuit_opened',
        entityType: 'agent_job',
        entityId: String(jobId),
        metadata: { reason: 'trial_failed', failureCount: job.circuitFailureCount },
      });

      return;
    }

    // Já aberto: outra falha chegando aqui é uma finalização tardia de um
    // Run que começou antes do circuito abrir (concorrência real, seção
    // 23) — só soma no contador, nunca reinicia circuit_opened_at (fazer
    // isso estenderia o cooldown indefinidamente enquanto stragglers
    // ainda estiverem terminando).
    if (job.circuitState === 'open') {
      await tx
        .update(agentJobs)
        .set({ circuitFailureCount: job.circuitFailureCount + 1 })
        .where(eq(agentJobs.id, jobId));

      return;
    }

    const nextFailureCount = job.circuitFailureCount + 1;

    if (nextFailureCount >= env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD) {
      await tx
        .update(agentJobs)
        .set({ circuitState: 'open', circuitFailureCount: nextFailureCount, circuitOpenedAt: new Date() })
        .where(eq(agentJobs.id, jobId));

      await audit({
        userId: null,
        actorType: 'system',
        actorId: null,
        action: 'agent_autonomy.circuit_opened',
        entityType: 'agent_job',
        entityId: String(jobId),
        metadata: { reason: 'failure_threshold_reached', failureCount: nextFailureCount, threshold: env.AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD },
      });

      return;
    }

    await tx.update(agentJobs).set({ circuitFailureCount: nextFailureCount }).where(eq(agentJobs.id, jobId));
  });
}
