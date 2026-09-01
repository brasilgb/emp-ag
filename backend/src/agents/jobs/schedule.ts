import type { ScheduleConfig } from './schemas.js';

/**
 * Agentes v1.3 (correio.md seção 4) — função pura, sem I/O: calcula o
 * próximo horário de execução a partir de um `scheduleConfig` já validado
 * (nunca cron arbitrário). Usada tanto na criação/edição do Job quanto
 * depois de cada Run agendado (agents/jobs/job-runner.ts).
 */
export function computeNextRunAt(config: ScheduleConfig, from: Date = new Date()): Date {
  if (config.frequency === 'hourly') {
    return new Date(from.getTime() + config.interval * 60 * 60 * 1000);
  }

  // daily: próxima ocorrência de hour:minute estritamente depois de
  // `from`, em UTC (determinístico independente do timezone do host).
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), config.hour, config.minute, 0, 0),
  );

  if (next.getTime() <= from.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}
