import { z } from 'zod';

// Agentes v1.6 (correio.md seção 3/10) — validação server-side dos
// filtros de período das rotas operacionais, mesmo padrão de
// coerce+default usado em agents/jobs/schemas.ts.
const isoDate = z.coerce.date();

export const operationsSummaryQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: '`from` deve ser anterior ou igual a `to`.',
    path: ['from'],
  });
