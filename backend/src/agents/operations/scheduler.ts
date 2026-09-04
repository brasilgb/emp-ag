import { audit } from '../../services/audit.js';
import { isOperationalSupervisionEnabled } from './scheduler-settings.js';
import { SupervisionAlreadyRunningError } from './supervisor-guard.js';
import { runObservedOperationalSupervision } from './supervision-run-history.js';
import { runOperationalSupervision } from './supervisor-service.js';
import type { RunOperationalSupervisionOptions } from './supervisor-service.js';
import type { OperationalSupervisionReport } from './health-types.js';

/**
 * Agentes v2.5.1 (correio.md seções 3/4/8) — reaproveita EXATAMENTE o
 * mesmo idioma já usado 2x neste projeto para infraestrutura de polling
 * (`agents/jobs/scheduler.ts` — Jobs `schedule`; `agents/events/worker.ts`
 * — Event Engine): `let xInterval: NodeJS.Timeout | null` + `startX`/
 * `stopX` idempotentes, `setInterval(...).unref()`, iniciado/parado só
 * por `server.ts` (nunca por `buildApp()`/testes). Esta é a TERCEIRA
 * instância do MESMO padrão estabelecido, não um "segundo scheduler" —
 * `Operational Supervisor != AgentJob` (seção 4): esta função nunca cria
 * `agent_jobs`, nunca usa `runAgentJob`/`pollDueJobs`, nunca compartilha
 * o timer do Jobs scheduler (concerns completamente diferentes: um
 * polla a tabela `agent_jobs`, este dispara `runOperationalSupervision`).
 *
 * Revisão do scheduler real (seção 3, feita antes de implementar):
 * `agents/jobs/scheduler.ts` inicia via `startJobScheduler(intervalMs)`,
 * chamado só em `server.ts` sob `env.AGENT_JOBS_SCHEDULER_ENABLED`;
 * usa `setInterval` (não cron), primeiro tick só após o 1º intervalo
 * (nunca dispara no boot); `.unref()` — nunca mantém o processo vivo
 * sozinho; evita sobreposição delegando ao lock+budget DENTRO de
 * `runAgentJob` (não no nível do próprio scheduler); cada erro por Job é
 * capturado individualmente dentro do poll, e o `.catch()` externo no
 * `setInterval` protege contra qualquer rejeição escapar; `stopJobScheduler()`
 * só limpa o timer (nenhuma espera pela tick em andamento). Mesmo
 * desenho replicado aqui.
 */
// `runner` injetável só para teste (mesmo padrão de `supervisor-guard.ts`)
// — permite provar isolamento de falha (seção 11/12) sem precisar
// derrubar banco/rede de verdade.
export async function runScheduledOperationalSupervision(
  runner: (options: RunOperationalSupervisionOptions) => Promise<OperationalSupervisionReport> = runOperationalSupervision,
): Promise<void> {
  const enabled = await isOperationalSupervisionEnabled();
  if (!enabled) return;

  lastTickAt = new Date();

  try {
    // v3.4 (correio.md "13. Scheduler" — "apenas registrar a origem como
    // scheduler no boundary adequado") — `runObservedOperationalSupervision`
    // envolve EXATAMENTE a mesma cadeia de antes
    // (`runGuardedOperationalSupervision` → advisory lock →
    // `runOperationalSupervision`) por fora, só adicionando o histórico
    // persistente; os erros que já propagavam daqui
    // (`SupervisionAlreadyRunningError`, falha estrutural) continuam
    // propagando exatamente igual — o `catch` abaixo é inalterado desde
    // a v2.5.1.
    await runObservedOperationalSupervision({ dryRun: false, actorUserId: null, triggeredBy: 'scheduler' }, runner);
    // `agents.operations.scan.started`/`.scan.completed` já são
    // auditados DENTRO de `runOperationalSupervision` (seção 16: "não
    // duplicar todos os eventos já emitidos") — nenhum
    // `scheduler.started` redundante aqui.
  } catch (error) {
    if (error instanceof SupervisionAlreadyRunningError) {
      // Seção 16: "skipped deve ser usado somente para situações
      // operacionais relevantes, como overlap" — nunca a cada tick
      // desabilitado (esses retornam antes, sem nenhum audit).
      await audit({
        userId: null,
        actorType: 'system',
        actorId: null,
        action: 'agents.operations.scheduler.skipped',
        entityType: 'agent_operational_supervision',
        entityId: null,
        metadata: { reason: 'overlap' },
      });
      return;
    }

    // Seção 11: "uma falha do Operational Supervisor jamais deve
    // derrubar o scheduler principal" — capturado aqui, nunca escapa
    // para o `.catch()` do `setInterval` (que também protege, em
    // profundidade).
    await audit({
      userId: null,
      actorType: 'system',
      actorId: null,
      action: 'agents.operations.scheduler.failed',
      entityType: 'agent_operational_supervision',
      entityId: null,
      metadata: { message: error instanceof Error ? error.message : 'Falha desconhecida na supervisão automática.' },
    });
  }
}

let supervisionInterval: NodeJS.Timeout | null = null;
let intervalSecondsInUse: number | null = null;
let lastTickAt: Date | null = null;
// Marca a hora em que o timer foi criado — antes do primeiro tick,
// `nextRunAt` (seção 17) é calculado a partir disto, não de `lastTickAt`
// (ainda `null` nesse momento, seção 20: "startup → aguarda primeiro
// intervalo → supervision", nunca dispara no boot).
let schedulerStartedAt: Date | null = null;

export function startOperationalSupervisionScheduler(intervalMs: number): void {
  if (supervisionInterval) {
    return;
  }

  intervalSecondsInUse = Math.round(intervalMs / 1000);
  schedulerStartedAt = new Date();

  supervisionInterval = setInterval(() => {
    runScheduledOperationalSupervision().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[operational-supervision-scheduler] falha inesperada no tick:', error);
    });
  }, intervalMs);

  supervisionInterval.unref?.();
}

export function stopOperationalSupervisionScheduler(): void {
  if (supervisionInterval) {
    clearInterval(supervisionInterval);
    supervisionInterval = null;
  }
  intervalSecondsInUse = null;
  lastTickAt = null;
  schedulerStartedAt = null;
}

/**
 * Agentes v2.5.1 (correio.md seção 17) — estado em memória necessário
 * só para `nextRunAt` (não derivável de audit logs — é uma PREVISÃO,
 * não um fato já ocorrido). O resto do status observável
 * (`enabled`/`running`/timestamps históricos) é montado por
 * `scheduler-status.ts`, que combina isto com a settings/guard/audit
 * logs — nunca duplicado aqui.
 */
export function getSchedulerRuntimeState(): { active: boolean; intervalSeconds: number | null; nextRunAt: Date | null } {
  const active = supervisionInterval !== null;
  const anchor = lastTickAt ?? schedulerStartedAt;
  const nextRunAt = active && anchor && intervalSecondsInUse ? new Date(anchor.getTime() + intervalSecondsInUse * 1000) : null;
  return { active, intervalSeconds: intervalSecondsInUse, nextRunAt };
}
