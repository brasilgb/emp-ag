import type { FastifyInstance } from 'fastify';

import { checkDatabase } from '../services/database.js';
import { checkRedis } from '../services/redis.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_request, reply) => {
    const [postgres, redis] = await Promise.all([
      checkDatabase(),
      checkRedis(),
    ]);

    const healthy = postgres && redis;

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      services: {
        api: true,
        postgres,
        redis,
      },
      timestamp: new Date().toISOString(),
    });
  });
}