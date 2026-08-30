import type {
  FastifyReply,
  FastifyRequest,
} from 'fastify';

export function requireRole(...allowedRoles: string[]) {
  return async function (
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const role = request.user.role;

    if (!allowedRoles.includes(role)) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Você não possui acesso a este recurso.',
      });
    }
  };
}