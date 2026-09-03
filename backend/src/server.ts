import { buildApp } from './app.js';
import { env } from './config/env.js';
import { database } from './services/database.js';
import { redis } from './services/redis.js';
import { recoverAbandonedRuns } from './agents/jobs/job-runner.js';
import { startJobScheduler, stopJobScheduler } from './agents/jobs/scheduler.js';
import { recoverAbandonedEvents } from './agents/events/event-processor.js';
import { startEventWorker, stopEventWorker } from './agents/events/worker.js';
import { startOperationalSupervisionScheduler, stopOperationalSupervisionScheduler } from './agents/operations/scheduler.js';

const app = buildApp();

// Agentes v1.3 (correio.md seções 20/21) — só aqui, nunca em
// buildApp()/app.ts (usado pelos testes de integração): recovery de Runs
// abandonados roda uma vez no boot; o scheduler (se ligado) começa a
// pollar depois.
try {
  const recovered = await recoverAbandonedRuns();

  if (recovered > 0) {
    app.log.warn({ recovered }, 'Runs de agentes abandonados marcados como failed:run_interrupted no boot.');
  }
} catch (error) {
  app.log.error(error, 'Falha ao rodar recoverAbandonedRuns() no boot.');
}

if (env.AGENT_JOBS_SCHEDULER_ENABLED) {
  startJobScheduler(env.AGENT_JOBS_SCHEDULER_INTERVAL_MS);
  app.log.info({ intervalMs: env.AGENT_JOBS_SCHEDULER_INTERVAL_MS }, 'Scheduler de Jobs de agentes iniciado.');
}

// Agentes v1.4 (correio.md seções 15/16) — mesmo padrão: recovery uma vez
// no boot, worker (se ligado) só depois. Nunca em buildApp()/testes.
try {
  const recoveredEvents = await recoverAbandonedEvents();

  if (recoveredEvents > 0) {
    app.log.warn({ recoveredEvents }, 'Eventos de agentes abandonados reclassificados no boot.');
  }
} catch (error) {
  app.log.error(error, 'Falha ao rodar recoverAbandonedEvents() no boot.');
}

if (env.AGENT_EVENTS_PROCESSOR_ENABLED) {
  startEventWorker(env.AGENT_EVENTS_POLL_INTERVAL_MS);
  app.log.info({ intervalMs: env.AGENT_EVENTS_POLL_INTERVAL_MS }, 'Event Engine worker iniciado.');
}

// Agentes v2.5.1 (correio.md seção 20) — mesmo padrão dos dois acima:
// timer só existe quando a CAPACIDADE de infraestrutura está ligada
// (`AGENT_OPERATIONAL_SUPERVISION_ENABLED`, default false); mesmo com o
// timer ativo, cada tick só dispara supervisão real se a DECISÃO
// operacional (setting persistido, também default false) estiver
// ligada — nunca dispara no boot, só após o primeiro intervalo
// (`setInterval`, nunca `setImmediate`/chamada direta aqui).
if (env.AGENT_OPERATIONAL_SUPERVISION_ENABLED) {
  startOperationalSupervisionScheduler(env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS * 1000);
  app.log.info({ intervalSeconds: env.AGENT_OPERATIONAL_SUPERVISION_INTERVAL_SECONDS }, 'Scheduler de Supervisão Operacional iniciado.');
}

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Encerrando aplicação');

  stopJobScheduler();
  stopEventWorker();
  stopOperationalSupervisionScheduler();
  await app.close();
  await database.end();

  if (redis.status !== 'end') {
    redis.disconnect();
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({
    port: env.PORT,
    host: env.HOST,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}