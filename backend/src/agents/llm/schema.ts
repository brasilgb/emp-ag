import { z } from 'zod';

// Seção 6/7: schema Zod obrigatório para a saída estruturada do modelo.
// `.strict()` é o mecanismo que rejeita os campos proibidos da seção 7
// (sql, code, shell, url, handler, permission, autonomy_level, ou
// qualquer outro campo não listado aqui) — nunca confiar em JSON só
// porque veio do modelo.
export const llmInterpretationSchema = z
  .object({
    agent: z.string().trim().min(1).nullable().optional(),
    tool: z.string().trim().min(1).nullable().optional(),
    arguments: z.record(z.string(), z.unknown()).default({}),
    confidence: z.number().min(0).max(1),
    clarificationRequired: z.boolean().optional(),
    clarificationQuestion: z.string().trim().min(1).optional(),
  })
  .strict();

export type LLMInterpretationPayload = z.infer<typeof llmInterpretationSchema>;
