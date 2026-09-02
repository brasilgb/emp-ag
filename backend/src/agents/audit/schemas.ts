import { z } from 'zod';

// Agentes v1.6 (correio.md seção 9) — filtros mínimos exigidos: action,
// actor/user, Job (entityType/entityId), intervalo de data. `entityType`
// fica livre (string) de propósito — audit_logs é usado por todo o
// projeto (CRM, financeiro, projetos...), não só por agentes; esta rota
// só filtra, nunca restringe o domínio de entityType a um enum fechado
// de agentes.
export const listAuditLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    action: z.string().trim().min(1).optional(),
    userId: z.coerce.number().int().positive().optional(),
    entityType: z.string().trim().min(1).optional(),
    entityId: z.string().trim().min(1).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();
