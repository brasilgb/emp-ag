import type { FastifyReply, FastifyRequest } from 'fastify';

import { redis } from '../../services/redis.js';

// Seção 47: proteção razoável em POST /agents/chat e POST /agents/execute.
// Sem lib nova (não há @fastify/rate-limit no projeto) — janela fixa via
// primitivas puras do ioredis (INCR + EXPIRE), a mesma abordagem simples
// já usada para o healthcheck de Redis (services/redis.ts). Fail-open se
// o Redis estiver fora do ar: nunca bloqueia o usuário por indisponibilidade
// de infraestrutura auxiliar.
const WINDOW_SECONDS = 60;
const MAX_REQUESTS: Record<'chat' | 'execute', number> = {
  chat: 30,
  execute: 30,
};

export function agentRateLimit(action: 'chat' | 'execute') {
  return async function rateLimitHandler(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.sub;

    if (!userId) {
      // authenticate roda antes deste preHandler na cadeia da rota; se
      // não houver usuário aqui, deixa o 401 de authenticate prevalecer.
      return;
    }

    const key = `agents:ratelimit:${action}:${userId}`;

    try {
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.expire(key, WINDOW_SECONDS);
      }

      if (count > MAX_REQUESTS[action]) {
        return reply.code(429).send({
          error: 'rate_limited',
          message: 'Muitas requisições. Aguarde um momento e tente novamente.',
        });
      }
    } catch (error) {
      request.log.warn({ err: error }, 'Falha ao aplicar rate limit de agentes — seguindo sem bloquear.');
    }
  };
}
