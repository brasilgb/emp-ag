import { processNextEvent } from './event-processor.js';

/**
 * Agentes v1.4 (correio.md seção 16) — worker/poller do Event Engine.
 * Só chama o serviço do Event Engine (`processNextEvent`) — nunca conhece
 * tools/Planner/LLM diretamente. Atrás de `AGENT_EVENTS_PROCESSOR_ENABLED`
 * (default `false`); iniciado só por server.ts, nunca por
 * buildApp()/testes/imports (mesmo padrão de agents/jobs/scheduler.ts).
 */

// Processa até esvaziar a fila (ou um teto de segurança por tick, para
// nunca monopolizar o poll indefinidamente se a fila estiver sempre cheia).
const MAX_EVENTS_PER_TICK = 20;

export async function drainPendingEvents(): Promise<number> {
  let processed = 0;

  for (let i = 0; i < MAX_EVENTS_PER_TICK; i += 1) {
    const outcome = await processNextEvent();

    if (outcome === 'no_event') {
      break;
    }

    processed += 1;
  }

  return processed;
}

let workerInterval: NodeJS.Timeout | null = null;

export function startEventWorker(intervalMs: number): void {
  if (workerInterval) {
    return;
  }

  workerInterval = setInterval(() => {
    drainPendingEvents().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[event-worker] falha inesperada no poll:', error);
    });
  }, intervalMs);

  workerInterval.unref?.();
}

export function stopEventWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
