import { buildApp } from './app.js';
import { env } from './config/env.js';
import { database } from './services/database.js';
import { redis } from './services/redis.js';

const app = buildApp();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Encerrando aplicação');

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