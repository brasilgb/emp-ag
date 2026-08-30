import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodError } from 'zod';

export function paginationMeta({
  page,
  limit,
  total,
}: {
  page: number;
  limit: number;
  total: number;
}) {
  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

export function badRequest(reply: FastifyReply, error: ZodError) {
  return reply.code(400).send({
    error: 'invalid_request',
    message: error.issues[0]?.message ?? 'Dados inválidos.',
  });
}

export function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({
    error: 'not_found',
    message,
  });
}

export function currentUserId(request: FastifyRequest): number {
  return Number(request.user.sub);
}
