import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

export async function connectRedis(): Promise<void> {
  if (redis.status === 'wait') {
    await redis.connect();
  }
}

export async function checkRedis(): Promise<boolean> {
  try {
    await connectRedis();

    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}