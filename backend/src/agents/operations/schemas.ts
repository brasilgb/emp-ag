import { z } from 'zod';

import { OPERATIONAL_INCIDENT_TYPES, OPERATIONAL_RESPONSES, OPERATIONAL_SEVERITIES } from './health-types.js';
import { INCIDENT_REVIEW_STATUSES, INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED } from './incident-review-service.js';
import { SUPERVISION_RUN_STATUSES } from './supervision-run-history.js';
import { AGING_BUCKETS, OPERATIONAL_OUTCOMES } from './supervision-insights-service.js';

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
  // Agentes v3.6 — filtro por review status (correio.md seção 8: "filtro
  // por review status"). Inclui `unreviewed` (estado sintetizado pela
  // ausência de linha, ver incident-review-service.ts) — filtrável como
  // qualquer outro estado.
  reviewStatus: z.enum(INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED).optional(),
  // Agentes v3.7 (correio.md "Filtros") — reaproveitados pela mesma
  // infraestrutura de filtro pós-enriquecimento da fila Needs Attention
  // (ver `attentionQueueQuerySchema` abaixo e `listSupervisionIncidents`
  // em supervision-insights-service.ts).
  outcome: z.enum(OPERATIONAL_OUTCOMES).optional(),
  recurringOnly: z.enum(['true', 'false']).optional(),
});

export const supervisionIncidentIdParamSchema = z.object({ auditLogId: z.coerce.number().int().positive() });

// Agentes v3.6 (correio.md "Operational Incident Acknowledgement & Review
// Workflow", seção 5) — payload de escrita do review: só `status`
// (nunca 'unreviewed' — não é um valor que o cliente possa setar, é
// puramente a ausência de linha) e `note` opcional. `.strict()` rejeita
// qualquer campo extra — em particular, IMPOSSÍVEL o cliente definir
// `reviewedBy`/`reviewedAt` (sempre derivados no servidor, seção 5:
// "Não permitir que o cliente defina usuário responsável; timestamps").
export const updateIncidentReviewSchema = z
  .object({
    status: z.enum(INCIDENT_REVIEW_STATUSES),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

// Agentes v3.7 (correio.md "Operational Incident Review Queue & Attention
// Management") — filtros da fila Needs Attention. `reviewStatus` ausente =
// default da fila (exclui `resolved`/`dismissed`, ver
// `listAttentionQueue`); informado explicitamente filtra por QUALQUER
// status, inclusive os dois excluídos por default (correio.md: "podem
// continuar acessíveis através dos filtros"). Mesmo vocabulário fechado de
// severidade/tipo/outcome/reviewStatus já usado pelo histórico acima —
// nenhuma segunda lista.
export const attentionQueueQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  severity: z.enum(OPERATIONAL_SEVERITIES).optional(),
  incidentType: z.enum(OPERATIONAL_INCIDENT_TYPES).optional(),
  outcome: z.enum(OPERATIONAL_OUTCOMES).optional(),
  reviewStatus: z.enum(INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED).optional(),
  recurringOnly: z.enum(['true', 'false']).optional(),
  agingBucket: z.enum(AGING_BUCKETS).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  // Agentes v3.8 (correio.md "Operational Incident Ownership &
  // Assignment", seção 13) — "evitar criar outro endpoint apenas para
  // 'My Incidents'; o mesmo endpoint da fila deve ser reutilizado".
  assigneeUserId: z.coerce.number().int().positive().optional(),
  unassignedOnly: z.enum(['true', 'false']).optional(),
});

// Agentes v3.8 (correio.md "Operational Incident Ownership & Assignment",
// seção 11) — payload de escrita do assignment: só `assigneeUserId`.
// `.strict()` rejeita qualquer campo extra — em particular, IMPOSSÍVEL o
// cliente definir `assignedBy`/`assignedAt` (sempre derivados no
// servidor, mesmo padrão de `updateIncidentReviewSchema` acima).
export const updateIncidentAssignmentSchema = z
  .object({
    assigneeUserId: z.number().int().positive(),
  })
  .strict();

// Agentes v4.1 (correio.md "Operational Incident Aging & SLA
// Visibility", seção 3) — todos os campos opcionais (atualização
// parcial: alterar só uma severidade não deveria exigir reenviar as
// outras). `.strict()` mesmo padrão de todo o resto deste arquivo.
// Limite (1..43200min/30 dias) validado de novo em
// `sla-settings.ts` (única fonte real de validação — aqui só a forma).
const slaMinutes = z.number().int().min(1).max(43200);
export const updateSlaSettingsSchema = z
  .object({
    critical: slaMinutes.optional(),
    warning: slaMinutes.optional(),
    info: slaMinutes.optional(),
  })
  .strict();
