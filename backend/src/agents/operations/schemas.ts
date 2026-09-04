import { z } from 'zod';

import { OPERATIONAL_INCIDENT_TYPES, OPERATIONAL_RESPONSES, OPERATIONAL_SEVERITIES } from './health-types.js';
import { SUPERVISION_RUN_STATUSES } from './supervision-run-history.js';

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

// Agentes v2.5 (correio.md seção 16/20/23) — `z.coerce.boolean()`
// coercionaria qualquer string não-vazia (inclusive "false") para
// `true` — nunca usado para query params boolean neste projeto (mesmo
// padrão já usado em agents/recovery/schemas.ts).
const booleanQueryFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

export const superviseQuerySchema = z.object({
  dryRun: booleanQueryFlag,
});

// Agentes v2.5.1 (correio.md seção 22) — PATCH só aceita `enabled`
// (nunca `intervalSeconds`, decisão documentada em `config/env.ts`:
// intervalo não é editável em runtime nesta versão) — `.strict()`
// rejeita qualquer campo extra, nunca aceita `{"command": "..."}`.
export const patchSupervisionSchedulerSchema = z.object({ enabled: z.boolean() }).strict();

// Agentes v3.4 (correio.md "11. API") — filtros mínimos pedidos:
// status/triggerSource/dateFrom/dateTo/page/pageSize (renomeado `limit`,
// mesmo padrão de `listFollowUpsQuerySchema` e de toda paginação já
// existente no projeto). Nenhuma busca textual (seção 11: "não
// implementar busca textual sem necessidade").
export const listSupervisionRunsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(SUPERVISION_RUN_STATUSES).optional(),
  triggerSource: z.enum(['scheduler', 'manual']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const supervisionRunIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

// Agentes v3.5 (correio.md "Operational Supervision Insights & Incident
// Review", seções 1/2/5) — filtros mínimos pedidos para overview/histórico:
// período, severidade, tipo/categoria do incidente, response aplicada,
// presença de escalonamento, agente/job (entityType/entityId). Vocabulário
// fechado sempre reaproveitado de health-types.ts (nunca uma segunda
// lista inventada aqui). `hasEscalation` deliberadamente SEM `.transform`
// (mesmo padrão de `overdue` em agents/followups/schemas.ts) — precisa
// permanecer tri-state (ausente = sem filtro, "true"/"false" = filtro
// real) na rota, nunca colapsado para boolean aqui.
export const supervisionInsightsOverviewQuerySchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const listSupervisionIncidentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  severity: z.enum(OPERATIONAL_SEVERITIES).optional(),
  incidentType: z.enum(OPERATIONAL_INCIDENT_TYPES).optional(),
  response: z.enum(OPERATIONAL_RESPONSES).optional(),
  hasEscalation: z.enum(['true', 'false']).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  runStatus: z.enum(SUPERVISION_RUN_STATUSES).optional(),
});

export const supervisionIncidentIdParamSchema = z.object({ auditLogId: z.coerce.number().int().positive() });
