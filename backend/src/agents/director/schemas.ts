import { z } from 'zod';

// Agentes v1.8 - validacao de entrada das rotas do Diretor.
export const signalIdParamSchema = z.object({
  id: z.string().trim().min(1),
});
