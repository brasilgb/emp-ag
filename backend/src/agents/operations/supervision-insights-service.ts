import { and, count, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentOperationalFollowUps, agentOperationalIncidentAssignments, agentOperationalIncidentReviews, agentOperationalSupervisionRuns, auditLogs } from '../../db/schema/index.js';
import { getIncidentReview, getIncidentReviewsByAuditLogIds, INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED } from './incident-review-service.js';
import type { IncidentReview, IncidentReviewStatusOrUnreviewed } from './incident-review-service.js';
import { getIncidentAssignmentsByAuditLogIds } from './incident-assignment-service.js';
import type { IncidentAssignment } from './incident-assignment-service.js';
import { OPERATIONAL_INCIDENT_TYPES, OPERATIONAL_RESPONSES, OPERATIONAL_SEVERITIES } from './health-types.js';
import type { OperationalIncidentType, OperationalResponse, OperationalSeverity } from './health-types.js';
import { SUPERVISION_RUN_STATUSES } from './supervision-run-history.js';
import type { SupervisionRunStatus } from './supervision-run-history.js';
import { getOperationalSlaMinutesBySeverity } from './sla-settings.js';
import type { OperationalSlaMinutesBySeverity } from './sla-settings.js';

/**
 * Agentes v3.5 (correio.md "Operational Supervision Insights & Incident
 * Review") — camada de LEITURA pura sobre dados já persistidos por v2.5
 * (Operational Supervisor), v2.6 (Escalations) e v3.4 (Run History).
 * Nenhuma tabela nova: nenhum "finding"/"incident" tinha (ou passa a ter)
 * uma linha própria — cada ocorrência de incidente já é, de forma
 * inequívoca e determinística, o audit log `agents.operations.incident.detected`
 * emitido por `applyResponse` (supervisor-service.ts) — um por incidente,
 * sempre, ANTES de qualquer efeito colateral (revisado em código antes de
 * desenhar isto). Esta é a "fonte oficial" reaproveitada (correio.md:
 * "reutilizar... auditoria existente", "não duplicar dados que já tenham
 * fonte oficial").
 *
 * Correlação incidente → run → resposta/resultado → escalation, toda
 * DETERMINÍSTICA (correio.md seção 4: "a regra deve ser determinística e
 * auditável"), nunca por IA/heurística difusa:
 *
 * - incidente → run: `agent_operational_supervision_runs` é populada por
 *   UM scan por vez (advisory lock exclusivo, v3.3/v3.3.1 — nunca dois
 *   scans concorrentes no sistema inteiro) — então o run cujo
 *   `[started_at, finished_at]` contém o `created_at` do audit de
 *   `incident.detected` é, garantidamente, o único candidato possível.
 * - incidente → resposta/resultado: a decisão (`response`) já vem no
 *   metadata do próprio `incident.detected`. O RESULTADO de aplicá-la é
 *   um audit subsequente dentro do mesmo incidente — `agents.operations.safe_recovery`/
 *   `.autonomy_restricted`/`.manual_attention` (sucesso) ou
 *   `agents.operations.incident.failed` (falha) — todos agora carregando
 *   `incidentType` no metadata (v3.5, aditivo — ver supervisor-service.ts)
 *   ao lado de `entityType`/`entityId`, que juntos formam exatamente
 *   `incident.id` (`type:entityType:entityId`, único por scan —
 *   `classifyIncidents` em incidents.ts deduplica por essa MESMA chave).
 *   Quando nenhum desses audits existe para um incidente cuja decisão foi
 *   `safe_recovery`/`restrict_autonomy`/`manual_attention`, o resultado
 *   real foi `skipped` — os 3 branches defensivos de `applyResponse` que
 *   devolvem `skipped`/`observed` sem side effect (entityType
 *   incompatível, entidade não está mais stale, restrição já
 *   inaplicável) deliberadamente não emitem um audit próprio (revisado em
 *   código: supervisor-service.ts, `applyResponse`) — não há o que
 *   auditar além do que `incident.detected` já registrou. Documentado
 *   aqui como limitação conhecida e aceita (correio.md seção 4: "Caso o
 *   modelo atual não possua chave adequada... documentar a limitação
 *   antes de propor schema novo") — a alternativa seria auditar também
 *   esses branches, fora do escopo desta versão (mudaria
 *   supervisor-service.ts além do aditivo já feito).
 * - incidente → escalation: `escalateSupervisorFinding` (v2.6) já grava
 *   `metadata.incidentId = incident.id` na própria Escalation
 *   (escalations/supervisor-integration.ts) — join exato, sem inferência
 *   por tempo.
 *
 * Recorrência (seção 4): mesmo incidente (`incidentType` + `entityType` +
 * `entityId`) detectado em mais de um scan. Chave 100% derivada do que já
 * existe — nenhum novo campo de agrupamento.
 */

// Agentes v3.7 (correio.md "Operational Incident Review Queue & Attention
// Management") — vocabulário fechado do outcome operacional (antes só um
// union inline em `SupervisionIncidentSummary`) e dos buckets de aging.
// Reexportados para schemas.ts, mesmo padrão de OPERATIONAL_* logo abaixo
// — nunca uma segunda lista solta no schema.
export const OPERATIONAL_OUTCOMES = ['observed', 'recovered', 'autonomy_restricted', 'escalated', 'failed', 'skipped'] as const;
export type SupervisionOutcome = (typeof OPERATIONAL_OUTCOMES)[number];

// Buckets fixos pedidos pelo correio.md (seção "Aging"). Limite esquerdo
// inclusivo, direito exclusivo — ex.: idade === exatamente 1h cai em
// `1h-4h` (não em `<1h`), idade === exatamente 4h cai em `4h-24h`, idade
// === exatamente 24h cai em `>24h`. Convenção documentada aqui porque o
// correio.md não especifica os limites — testada explicitamente
// (operations.test.ts) nos 3 limites.
export const AGING_BUCKETS = ['<1h', '1h-4h', '4h-24h', '>24h'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

const HOUR_MS = 60 * 60 * 1000;

function agingBucketFromMs(ageMs: number): AgingBucket {
  if (ageMs < HOUR_MS) return '<1h';
  if (ageMs < 4 * HOUR_MS) return '1h-4h';
  if (ageMs < 24 * HOUR_MS) return '4h-24h';
  return '>24h';
}

export interface SupervisionOverview {
  totalRuns: number;
  runsByStatus: Record<SupervisionRunStatus, number>;
  totalFindings: number;
  totalIncidentsDetected: number;
  incidentsBySeverity: Record<OperationalSeverity, number>;
  responsesApplied: {
    observed: number;
    recovered: number;
    autonomyRestricted: number;
    escalated: number;
    failed: number;
  };
  escalationsCreated: number;
  recurringIncidentsCount: number;
  // Agentes v3.6 (correio.md "Operational Incident Acknowledgement &
  // Review Workflow", seção 8) — `unreviewed` sempre derivado (nunca
  // persistido, ver docblock de incident-review-service.ts).
  reviewsByStatus: Record<IncidentReviewStatusOrUnreviewed, number>;
}

export interface SupervisionInsightsFilterParams {
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Todo contador é uma única query agregada sobre tabelas já existentes
 * (mesmo idioma de control-center-service.ts) — nenhum número persistido,
 * nenhum cálculo no frontend (correio.md seção 5).
 */
export async function getSupervisionOverview(params: SupervisionInsightsFilterParams = {}): Promise<SupervisionOverview> {
  const runConditions: SQL[] = [];
  if (params.dateFrom) runConditions.push(gte(agentOperationalSupervisionRuns.startedAt, params.dateFrom));
  if (params.dateTo) runConditions.push(lte(agentOperationalSupervisionRuns.startedAt, params.dateTo));
  const runWhere = runConditions.length > 0 ? and(...runConditions) : undefined;

  const incidentConditions: SQL[] = [eq(auditLogs.action, 'agents.operations.incident.detected')];
  if (params.dateFrom) incidentConditions.push(gte(auditLogs.createdAt, params.dateFrom));
  if (params.dateTo) incidentConditions.push(lte(auditLogs.createdAt, params.dateTo));

  const escalationConditions: SQL[] = [eq(auditLogs.action, 'agents.operations.manual_attention')];
  if (params.dateFrom) escalationConditions.push(gte(auditLogs.createdAt, params.dateFrom));
  if (params.dateTo) escalationConditions.push(lte(auditLogs.createdAt, params.dateTo));

  const [runRows, [findingsRow], severityRows, outcomeRows, [escalationsRow], recurringRows, reviewStatusRows] = await Promise.all([
    db
      .select({ status: agentOperationalSupervisionRuns.status, total: count() })
      .from(agentOperationalSupervisionRuns)
      .where(runWhere)
      .groupBy(agentOperationalSupervisionRuns.status),

    db
      .select({
        totalFindings: sql<number>`coalesce(sum(${agentOperationalSupervisionRuns.findingsCount}), 0)`,
        totalIncidentsDetected: count(),
      })
      .from(agentOperationalSupervisionRuns)
      .where(runWhere),

    db
      .select({ severity: sql<string>`${auditLogs.metadata}->>'severity'`, total: count() })
      .from(auditLogs)
      .where(and(...incidentConditions))
      .groupBy(sql`${auditLogs.metadata}->>'severity'`),

    db
      .select({ action: auditLogs.action, total: count() })
      .from(auditLogs)
      .where(
        and(
          inArray(auditLogs.action, [
            'agents.operations.incident.detected',
            'agents.operations.safe_recovery',
            'agents.operations.autonomy_restricted',
            'agents.operations.incident.failed',
          ]),
          ...(params.dateFrom ? [gte(auditLogs.createdAt, params.dateFrom)] : []),
          ...(params.dateTo ? [lte(auditLogs.createdAt, params.dateTo)] : []),
        ),
      )
      .groupBy(auditLogs.action),

    db.select({ total: count() }).from(auditLogs).where(and(...escalationConditions)),

    db
      .select({
        incidentType: sql<string>`${auditLogs.metadata}->>'incidentType'`,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        occurrences: count(),
      })
      .from(auditLogs)
      .where(and(...incidentConditions))
      .groupBy(sql`${auditLogs.metadata}->>'incidentType'`, auditLogs.entityType, auditLogs.entityId)
      .having(sql`count(*) > 1`),

    // Agentes v3.6 — LEFT JOIN + coalesce resolve `unreviewed` (ausência
    // de linha) na MESMA query que os demais status, escopado ao mesmo
    // conjunto de incidentes do resto do overview (período de
    // `incident.detected`, não de `reviewed_at` — "quantos incidentes
    // DESTE período estão em cada estado de revisão", nunca "quantas
    // revisões aconteceram neste período"). Uma única query, nenhum N+1.
    db
      .select({ status: sql<string>`coalesce(${agentOperationalIncidentReviews.status}, 'unreviewed')`, total: count() })
      .from(auditLogs)
      .leftJoin(agentOperationalIncidentReviews, eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogs.id))
      .where(and(...incidentConditions))
      .groupBy(sql`coalesce(${agentOperationalIncidentReviews.status}, 'unreviewed')`),
  ]);

  const runsByStatus = Object.fromEntries(SUPERVISION_RUN_STATUSES.map((status) => [status, 0])) as Record<SupervisionRunStatus, number>;
  for (const row of runRows) {
    if (row.status && (SUPERVISION_RUN_STATUSES as readonly string[]).includes(row.status)) {
      runsByStatus[row.status as SupervisionRunStatus] = Number(row.total);
    }
  }

  const incidentsBySeverity = Object.fromEntries(OPERATIONAL_SEVERITIES.map((severity) => [severity, 0])) as Record<OperationalSeverity, number>;
  for (const row of severityRows) {
    if (row.severity && (OPERATIONAL_SEVERITIES as readonly string[]).includes(row.severity)) {
      incidentsBySeverity[row.severity as OperationalSeverity] = Number(row.total);
    }
  }

  const outcomeCountByAction = new Map(outcomeRows.map((row) => [row.action, Number(row.total)]));

  const reviewsByStatus = Object.fromEntries(INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED.map((status) => [status, 0])) as Record<IncidentReviewStatusOrUnreviewed, number>;
  for (const row of reviewStatusRows) {
    if ((INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED as readonly string[]).includes(row.status)) {
      reviewsByStatus[row.status as IncidentReviewStatusOrUnreviewed] = Number(row.total);
    }
  }

  return {
    totalRuns: runRows.reduce((sum, row) => sum + Number(row.total), 0),
    runsByStatus,
    totalFindings: Number(findingsRow?.totalFindings ?? 0),
    totalIncidentsDetected: outcomeCountByAction.get('agents.operations.incident.detected') ?? 0,
    incidentsBySeverity,
    responsesApplied: {
      // 'observed'/'already_handled'/'skipped' nunca têm um audit
      // dedicado (ver docblock do arquivo) — só é derivável como "o
      // resto": total de incidentes detectados menos os que tiveram um
      // resultado auditável específico.
      observed: Math.max(
        0,
        (outcomeCountByAction.get('agents.operations.incident.detected') ?? 0) -
          (outcomeCountByAction.get('agents.operations.safe_recovery') ?? 0) -
          (outcomeCountByAction.get('agents.operations.autonomy_restricted') ?? 0) -
          (outcomeCountByAction.get('agents.operations.incident.failed') ?? 0) -
          (escalationsRow ? Number(escalationsRow.total) : 0),
      ),
      recovered: outcomeCountByAction.get('agents.operations.safe_recovery') ?? 0,
      autonomyRestricted: outcomeCountByAction.get('agents.operations.autonomy_restricted') ?? 0,
      escalated: escalationsRow ? Number(escalationsRow.total) : 0,
      failed: outcomeCountByAction.get('agents.operations.incident.failed') ?? 0,
    },
    escalationsCreated: escalationsRow ? Number(escalationsRow.total) : 0,
    recurringIncidentsCount: recurringRows.length,
    reviewsByStatus,
  };
}

/**
 * Agentes v4.1 (correio.md "Operational Incident Aging & SLA
 * Visibility") — vocabulário fechado do status temporal (correio.md
 * seção 4). `completed` representa um incidente cujo review já foi
 * encerrado (`resolved`/`dismissed`) — o cálculo de `remainingSeconds`/
 * `breachedAt` fica CONGELADO no timestamp real de encerramento (a
 * transição exata, derivada do histórico de review — v3.6 — nunca só
 * "agora"), então um incidente fechado nunca volta a ser reportado como
 * breach novo (correio.md seção 7).
 */
export const OPERATIONAL_INCIDENT_SLA_STATUSES = ['within_sla', 'warning', 'breached', 'completed'] as const;
export type OperationalIncidentSlaStatus = (typeof OPERATIONAL_INCIDENT_SLA_STATUSES)[number];

/**
 * Campos aplicáveis à LISTA (histórico/fila) — correio.md seção 8:
 * "separar claramente dados necessários à lista; dados detalhados do
 * diálogo". `lastActivityAt`/`lastActivityAgeSeconds` aqui são uma
 * APROXIMAÇÃO barata (max(detectedAt, review.reviewedAt, assignment.assignedAt),
 * já carregados em lote por `enrichIncidentRows` — nenhuma query extra),
 * documentada como tal: não inclui escalation/follow-up (exigiria
 * carregar a timeline inteira POR LINHA, exatamente o que correio.md
 * seção 14 proíbe: "se a timeline completa não for necessária... não
 * carregá-la individualmente para cada item"). O valor EXATO (via
 * timeline completa) só existe em `OperationalIncidentSlaDetail`.
 */
export interface OperationalIncidentSla {
  status: OperationalIncidentSlaStatus;
  detectedAt: string;
  ageSeconds: number;
  deadlineAt: string | null;
  remainingSeconds: number | null;
  breachedAt: string | null;
  assignedAt: string | null;
  assignmentAgeSeconds: number | null;
  lastActivityAt: string;
  lastActivityAgeSeconds: number;
}

/**
 * Superset só do DETALHE (um item, nunca uma lista — mesmo racional já
 * aceito para `review`/`escalation`/`timeline` desde v3.5/v4.0): exige a
 * transição REAL de "primeiro acknowledge" (do histórico de audits de
 * review, v3.6) e a timeline completa (v4.0) para `lastActivityAt`
 * exato — caro demais para calcular por linha numa lista, barato o
 * bastante para UM incidente.
 */
export interface OperationalIncidentSlaDetail extends OperationalIncidentSla {
  acknowledgedAt: string | null;
  acknowledgementSeconds: number | null;
}

// Fração do prazo total que, restando, já conta como "warning" — a
// política mais simples que satisfaz o requisito (correio.md seção 3),
// nunca persistida (constante de apresentação, mesmo idioma de
// `AGING_BUCKETS`/`HOUR_MS` acima). 20% do prazo restante: para SLA
// critical (60min) o warning começa a 12min do prazo; para info
// (1440min), a 288min (4.8h) do prazo — proporcional à severidade,
// nunca um limiar fixo que faria o SLA inteiro de `critical` virar
// "warning" desde o primeiro minuto.
const SLA_WARNING_REMAINING_FRACTION = 0.2;

export interface ComputeIncidentSlaInput {
  severity: OperationalSeverity;
  detectedAt: Date;
  reviewStatus: IncidentReviewStatusOrUnreviewed;
  // Timestamp REAL da transição de encerramento (resolved/dismissed),
  // derivado do histórico — `null` quando o incidente não está
  // encerrado. Nunca inferido de "agora".
  closedAt: Date | null;
  assignedAt: Date | null;
  lastActivityAt: Date;
  now: Date;
  slaMinutesBySeverity: OperationalSlaMinutesBySeverity;
}

/**
 * Pura, sem I/O — testável isoladamente (correio.md "16. Testes
 * obrigatórios", itens 1-5/11/12/19). Nunca persiste nada (correio.md
 * seção 2: "age/timeToBreach/overdue/breachedAt... não devem ser
 * persistidos").
 */
// Exportada para teste unitário puro, sem banco (mesmo padrão de
// `sortOperationalIncidentTimelineEvents`, v4.0) — a maioria dos itens
// obrigatórios de teste da v4.1 (dentro do SLA/warning/breached/deadline/
// tempo restante/completed) são testáveis diretamente aqui, sem precisar
// de fixtures no Postgres.
export function computeIncidentSla(input: ComputeIncidentSlaInput): OperationalIncidentSla {
  const { severity, detectedAt, reviewStatus, closedAt, assignedAt, lastActivityAt, now, slaMinutesBySeverity } = input;

  const ageSeconds = Math.max(0, Math.round((now.getTime() - detectedAt.getTime()) / 1000));
  const slaSeconds = slaMinutesBySeverity[severity] * 60;
  const deadlineAt = new Date(detectedAt.getTime() + slaSeconds * 1000);

  const isCompleted = reviewStatus === 'resolved' || reviewStatus === 'dismissed';
  const referenceTime = isCompleted && closedAt ? closedAt : now;
  const remainingSeconds = Math.round((deadlineAt.getTime() - referenceTime.getTime()) / 1000);
  const isPastDeadline = remainingSeconds < 0;

  let status: OperationalIncidentSlaStatus;
  if (isCompleted) status = 'completed';
  else if (isPastDeadline) status = 'breached';
  else if (remainingSeconds <= slaSeconds * SLA_WARNING_REMAINING_FRACTION) status = 'warning';
  else status = 'within_sla';

  return {
    status,
    detectedAt: detectedAt.toISOString(),
    ageSeconds,
    deadlineAt: deadlineAt.toISOString(),
    remainingSeconds,
    breachedAt: isPastDeadline ? deadlineAt.toISOString() : null,
    assignedAt: assignedAt ? assignedAt.toISOString() : null,
    assignmentAgeSeconds: assignedAt ? Math.max(0, Math.round((now.getTime() - assignedAt.getTime()) / 1000)) : null,
    lastActivityAt: lastActivityAt.toISOString(),
    lastActivityAgeSeconds: Math.max(0, Math.round((now.getTime() - lastActivityAt.getTime()) / 1000)),
  };
}

export interface SupervisionIncidentSummary {
  auditLogId: number;
  incidentType: OperationalIncidentType;
  entityType: string;
  entityId: string;
  severity: OperationalSeverity;
  response: OperationalResponse;
  dryRun: boolean;
  detectedAt: string;
  runId: number | null;
  runStatus: SupervisionRunStatus | null;
  outcome: SupervisionOutcome;
  hasEscalation: boolean;
  // Agentes v3.6 — dimensão SEPARADA do `outcome` acima (correio.md
  // seção 8: "nunca misturá-las" — resultado operacional vs. review
  // humano são conceitos distintos; um incidente pode ter sido
  // `recovered` automaticamente e ainda estar `unreviewed`).
  reviewStatus: IncidentReviewStatusOrUnreviewed;
  // Agentes v3.7 — recorrência (correio.md "Prioridade operacional" /
  // "Aging"): mesma chave `incidentType:entityType:entityId` já usada por
  // `listRecurringIncidents` (v3.5), agora exposta por LINHA em vez de só
  // numa lista separada — reaproveita a MESMA definição de recorrência,
  // nunca uma segunda noção. `recurrenceCount` inclui a própria ocorrência
  // (>= 1 sempre); `isRecurring` é só `recurrenceCount > 1`, açúcar para o
  // frontend nunca precisar repetir essa comparação.
  recurrenceCount: number;
  isRecurring: boolean;
  // Agentes v3.8 (correio.md "Operational Incident Ownership &
  // Assignment", seções 12/13) — ownership humano, dimensão SEPARADA de
  // `reviewStatus` (assign ≠ acknowledge, seção 6). `null` = não
  // atribuído (correio.md seção 13: "assignment: null" ou o objeto) —
  // mesmo idioma de `unreviewed` internamente (ausência de linha em
  // `agent_operational_incident_assignments`, ver
  // incident-assignment-service.ts), só achatado aqui para nunca expor
  // um objeto redundante `{ assigneeUserId: null, ... }`. Raw
  // `assigneeUserId` (não o nome) — resolução de nome fica a cargo do
  // frontend via `useUsersDirectory` (mesmo padrão já usado para
  // `review.reviewedBy`, evita uma segunda estratégia de resolução de
  // nomes e um segundo join batched só para isso).
  assignment: { assigneeUserId: number; assignedBy: number; assignedAt: string } | null;
  // Agentes v4.1 — visibilidade de aging/SLA (correio.md "Operational
  // Incident Aging & SLA Visibility"). Calculado em tempo de leitura,
  // NUNCA persistido (correio.md seção 2). Ver docblock de
  // `OperationalIncidentSla` acima para a diferença entre este campo
  // (lista) e o superset exposto em `SupervisionIncidentDetail.sla`.
  sla: OperationalIncidentSla;
}

export interface ListSupervisionIncidentsParams {
  page: number;
  limit: number;
  dateFrom?: Date;
  dateTo?: Date;
  severity?: OperationalSeverity;
  incidentType?: OperationalIncidentType;
  response?: OperationalResponse;
  hasEscalation?: boolean;
  entityType?: string;
  entityId?: string;
  runStatus?: SupervisionRunStatus;
  reviewStatus?: IncidentReviewStatusOrUnreviewed;
  // Agentes v3.7 — mesmos filtros usados pela fila Needs Attention
  // (`listAttentionQueue` abaixo), adicionados aqui para que histórico e
  // fila reutilizem a MESMA infraestrutura de filtro pós-enriquecimento
  // (correio.md "Filtros": "evitar duplicar dois mecanismos diferentes de
  // filtro entre histórico e fila").
  outcome?: SupervisionOutcome;
  recurringOnly?: boolean;
  // Agentes v4.1 — mesmo relógio injetável de `listAttentionQueue`
  // (aging/SLA calculados aqui também, via `enrichIncidentRows`).
  now?: Date;
}

const OUTCOME_AUDIT_ACTIONS = ['agents.operations.safe_recovery', 'agents.operations.autonomy_restricted', 'agents.operations.manual_attention', 'agents.operations.incident.failed'] as const;

function outcomeFromAction(action: (typeof OUTCOME_AUDIT_ACTIONS)[number] | undefined, response: OperationalResponse): SupervisionOutcome {
  if (!action) {
    // Nenhum audit de resultado — ver docblock do arquivo: só acontece
    // nos branches defensivos de `applyResponse` que devolvem
    // `skipped`/`observed` sem side effect, ou quando a decisão em si já
    // era `observe`/`already_handled` (nunca tenta nada, `outcome`
    // sempre 'observed').
    return response === 'observe' || response === 'already_handled' ? 'observed' : 'skipped';
  }
  if (action === 'agents.operations.safe_recovery') return 'recovered';
  if (action === 'agents.operations.autonomy_restricted') return 'autonomy_restricted';
  if (action === 'agents.operations.manual_attention') return 'escalated';
  return 'failed';
}

/**
 * Resolve, para um lote de audits `incident.detected` já carregado, o run
 * de origem (por janela de tempo — único candidato possível, ver
 * docblock), o audit de resultado (por entityType+entityId+incidentType
 * exato), a presença de escalation (por `metadata.incidentId` exato) e o
 * review humano (v3.6, `getIncidentReviewsByAuditLogIds` — já em lote por
 * design, ver incident-review-service.ts). Sempre no máximo 4 queries
 * extras, nunca uma por linha (evita N+1 — correio.md v3.6 seção 8/11
 * item 15).
 */
async function enrichIncidentRows(
  rows: { id: number; entityType: string | null; entityId: string | null; metadata: unknown; createdAt: Date }[],
  // Agentes v4.1 — relógio injetável (mesmo padrão de `listAttentionQueue`
  // desde a v3.7: "preferir relógio controlável/injetável nos testes de
  // aging") — default `new Date()` em produção, fixo nos testes.
  now: Date = new Date(),
): Promise<SupervisionIncidentSummary[]> {
  if (rows.length === 0) return [];

  const createdAts = rows.map((row) => row.createdAt.getTime());
  const minCreatedAt = new Date(Math.min(...createdAts));
  const maxCreatedAt = new Date(Math.max(...createdAts));

  const entityTypes = [...new Set(rows.map((row) => row.entityType).filter((value): value is string => value !== null))];
  const entityIds = [...new Set(rows.map((row) => row.entityId).filter((value): value is string => value !== null))];

  const incidentIds = rows.map((row) => {
    const metadata = row.metadata as { incidentType?: string } | null;
    return `${metadata?.incidentType ?? 'unknown'}:${row.entityType}:${row.entityId}`;
  });

  const [candidateRuns, outcomeAudits, escalationRows, reviewsByAuditLogId, recurrenceRows, assignmentsByAuditLogId, slaMinutesBySeverity] = await Promise.all([
    db
      .select({ id: agentOperationalSupervisionRuns.id, status: agentOperationalSupervisionRuns.status, startedAt: agentOperationalSupervisionRuns.startedAt, finishedAt: agentOperationalSupervisionRuns.finishedAt })
      .from(agentOperationalSupervisionRuns)
      .where(and(lte(agentOperationalSupervisionRuns.startedAt, maxCreatedAt), sql`(${agentOperationalSupervisionRuns.finishedAt} is null or ${agentOperationalSupervisionRuns.finishedAt} >= ${minCreatedAt})`)),

    entityTypes.length > 0 && entityIds.length > 0
      ? db
          .select({ action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
          .from(auditLogs)
          .where(
            and(
              inArray(auditLogs.action, [...OUTCOME_AUDIT_ACTIONS]),
              inArray(auditLogs.entityType, entityTypes),
              inArray(auditLogs.entityId, entityIds),
              gte(auditLogs.createdAt, minCreatedAt),
            ),
          )
      : Promise.resolve([]),

    db
      .select({ metadata: agentOperationalEscalations.metadata })
      .from(agentOperationalEscalations)
      .where(inArray(sql<string>`${agentOperationalEscalations.metadata}->>'incidentId'`, incidentIds)),

    getIncidentReviewsByAuditLogIds(rows.map((row) => row.id)),

    // Agentes v3.7 — recorrência em LOTE (nunca uma query por linha):
    // mesma chave/mesma definição de `listRecurringIncidents` (v3.5),
    // agrupada por `incidentType:entityType:entityId` só para as
    // combinações realmente presentes nesta página (`IN` em
    // entityType/entityId, exatamente como a query de escalation acima —
    // o `having count(*) > 1` de `listRecurringIncidents` não se aplica
    // aqui de propósito: precisamos da CONTAGEM real mesmo quando é 1,
    // não só saber se é recorrente).
    entityTypes.length > 0 && entityIds.length > 0
      ? db
          .select({
            incidentType: sql<string>`${auditLogs.metadata}->>'incidentType'`,
            entityType: auditLogs.entityType,
            entityId: auditLogs.entityId,
            occurrences: count(),
          })
          .from(auditLogs)
          .where(and(eq(auditLogs.action, 'agents.operations.incident.detected'), inArray(auditLogs.entityType, entityTypes), inArray(auditLogs.entityId, entityIds)))
          .groupBy(sql`${auditLogs.metadata}->>'incidentType'`, auditLogs.entityType, auditLogs.entityId)
      : Promise.resolve([]),

    // Agentes v3.8 — ownership em LOTE (correio.md seção 19: "não pode
    // transformar listAttentionQueue em consulta por linha"), mesmo
    // padrão de `getIncidentReviewsByAuditLogIds` acima.
    getIncidentAssignmentsByAuditLogIds(rows.map((row) => row.id)),

    // Agentes v4.1 — UMA única leitura de config (nunca por linha,
    // nunca por severidade) compartilhada por toda a página.
    getOperationalSlaMinutesBySeverity(),
  ]);

  const recurrenceByIncidentId = new Map(recurrenceRows.map((row) => [`${row.incidentType}:${row.entityType}:${row.entityId}`, Number(row.occurrences)]));

  const escalatedIncidentIds = new Set(
    escalationRows.map((row) => (row.metadata as { incidentId?: string } | null)?.incidentId).filter((value): value is string => value !== undefined),
  );

  return rows.map((row) => {
    const metadata = row.metadata as { incidentType?: string; severity?: string; response?: string; dryRun?: boolean } | null;
    const incidentType = (metadata?.incidentType ?? 'operational_degradation') as OperationalIncidentType;
    const severity = (metadata?.severity ?? 'info') as OperationalSeverity;
    const response = (metadata?.response ?? 'observe') as OperationalResponse;
    const incidentId = `${incidentType}:${row.entityType}:${row.entityId}`;

    const run = candidateRuns
      .filter((candidate) => candidate.startedAt.getTime() <= row.createdAt.getTime() && (candidate.finishedAt === null || candidate.finishedAt.getTime() >= row.createdAt.getTime()))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

    const outcomeAudit = outcomeAudits
      .filter((audit) => {
        const auditMetadata = audit.metadata as { incidentType?: string } | null;
        return audit.entityType === row.entityType && audit.entityId === row.entityId && auditMetadata?.incidentType === incidentType && audit.createdAt.getTime() >= row.createdAt.getTime();
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    const review = reviewsByAuditLogId.get(row.id);
    const reviewStatus = review?.status ?? 'unreviewed';
    const assignment = toAssignmentSummary(assignmentsByAuditLogId.get(row.id));

    // Agentes v4.1 — `lastActivityAt` aproximado (documentado no
    // docblock de `OperationalIncidentSla`): max(detecção, review,
    // assignment) — tudo já em memória, nenhuma query extra.
    const activityTimestamps = [row.createdAt.getTime()];
    if (review?.reviewedAt) activityTimestamps.push(new Date(review.reviewedAt).getTime());
    if (assignment?.assignedAt) activityTimestamps.push(new Date(assignment.assignedAt).getTime());
    const lastActivityAt = new Date(Math.max(...activityTimestamps));

    const isCompleted = reviewStatus === 'resolved' || reviewStatus === 'dismissed';

    return {
      auditLogId: row.id,
      incidentType,
      entityType: row.entityType ?? '',
      entityId: row.entityId ?? '',
      severity,
      response,
      dryRun: metadata?.dryRun ?? false,
      detectedAt: row.createdAt.toISOString(),
      runId: run?.id ?? null,
      runStatus: (run?.status as SupervisionRunStatus | undefined) ?? null,
      outcome: outcomeFromAction(outcomeAudit?.action as (typeof OUTCOME_AUDIT_ACTIONS)[number] | undefined, response),
      hasEscalation: escalatedIncidentIds.has(incidentId),
      reviewStatus,
      recurrenceCount: recurrenceByIncidentId.get(incidentId) ?? 1,
      isRecurring: (recurrenceByIncidentId.get(incidentId) ?? 1) > 1,
      assignment,
      sla: computeIncidentSla({
        severity,
        detectedAt: row.createdAt,
        reviewStatus,
        // Aproximação ao nível de lista (documentada acima): usa
        // `review.reviewedAt` como o timestamp de encerramento quando o
        // status corrente já é resolved/dismissed — é exatamente a
        // transição de fechamento nesse caso, porque `reviewedAt` é
        // sempre atualizado na ÚLTIMA transição (upsertIncidentReview).
        closedAt: isCompleted && review?.reviewedAt ? new Date(review.reviewedAt) : null,
        assignedAt: assignment?.assignedAt ? new Date(assignment.assignedAt) : null,
        lastActivityAt,
        now,
        slaMinutesBySeverity,
      }),
    };
  });
}

// Agentes v3.8 — achata `IncidentAssignment` (que sintetiza "não
// atribuído" como `assigneeUserId: null`) para o formato exposto em
// `SupervisionIncidentSummary.assignment` (correio.md seção 13:
// `assignment: null` ou o objeto completo — nunca um objeto com campos
// nulos por dentro).
function toAssignmentSummary(assignment: IncidentAssignment | undefined): SupervisionIncidentSummary['assignment'] {
  if (!assignment || assignment.assigneeUserId === null || assignment.assignedBy === null || assignment.assignedAt === null) return null;
  return { assigneeUserId: assignment.assigneeUserId, assignedBy: assignment.assignedBy, assignedAt: assignment.assignedAt };
}

export async function listSupervisionIncidents(params: ListSupervisionIncidentsParams): Promise<{ rows: SupervisionIncidentSummary[]; total: number }> {
  const conditions: SQL[] = [eq(auditLogs.action, 'agents.operations.incident.detected')];
  if (params.dateFrom) conditions.push(gte(auditLogs.createdAt, params.dateFrom));
  if (params.dateTo) conditions.push(lte(auditLogs.createdAt, params.dateTo));
  if (params.severity) conditions.push(sql`${auditLogs.metadata}->>'severity' = ${params.severity}`);
  if (params.incidentType) conditions.push(sql`${auditLogs.metadata}->>'incidentType' = ${params.incidentType}`);
  if (params.response) conditions.push(sql`${auditLogs.metadata}->>'response' = ${params.response}`);
  if (params.entityType) conditions.push(eq(auditLogs.entityType, params.entityType));
  if (params.entityId) conditions.push(eq(auditLogs.entityId, params.entityId));

  const where = and(...conditions);

  const needsPostEnrichmentFilter =
    params.hasEscalation !== undefined || params.runStatus !== undefined || params.reviewStatus !== undefined || params.outcome !== undefined || params.recurringOnly !== undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ id: auditLogs.id, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      // busca uma janela maior que a página pedida quando há filtros
      // pós-enriquecimento (runStatus/hasEscalation/reviewStatus,
      // v3.6), paginados em memória depois — ver comentário abaixo.
      .limit(needsPostEnrichmentFilter ? 500 : params.limit)
      .offset(needsPostEnrichmentFilter ? 0 : (params.page - 1) * params.limit),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);

  let enriched = await enrichIncidentRows(rows, params.now);

  // `runStatus`/`hasEscalation`/`reviewStatus` só existem depois do
  // enriquecimento (não são campos nativos do audit log) — filtrados
  // aqui. Janela de 500 (acima) é uma concessão pragmática: suficiente
  // para qualquer volume operacional real deste sistema (não um SaaS
  // multi-tenant de alto volume), documentado como limitação conhecida
  // em vez de introduzir uma view materializada não pedida pelo
  // correio.md.
  let total2 = Number(total);
  if (params.hasEscalation !== undefined) {
    enriched = enriched.filter((row) => row.hasEscalation === params.hasEscalation);
    total2 = enriched.length;
  }
  if (params.runStatus) {
    enriched = enriched.filter((row) => row.runStatus === params.runStatus);
    total2 = enriched.length;
  }
  if (params.reviewStatus) {
    enriched = enriched.filter((row) => row.reviewStatus === params.reviewStatus);
    total2 = enriched.length;
  }
  if (params.outcome) {
    enriched = enriched.filter((row) => row.outcome === params.outcome);
    total2 = enriched.length;
  }
  if (params.recurringOnly) {
    enriched = enriched.filter((row) => row.isRecurring);
    total2 = enriched.length;
  }
  if (needsPostEnrichmentFilter) {
    enriched = enriched.slice((params.page - 1) * params.limit, params.page * params.limit);
  }

  return { rows: enriched, total: total2 };
}

/**
 * Agentes v4.0 (correio.md "Operational Incident Collaboration &
 * Activity Timeline") — rastreabilidade cronológica pura sobre eventos JÁ
 * auditados por v3.6 (`agents.operations.incident_review.changed`) e v3.8
 * (`agents.operations.incident.assigned`/`.reassigned`/`.unassigned`), mais
 * a criação de Escalation (v2.6) e FollowUp (v2.7) já ligados ao incidente
 * pela MESMA `incidentId` string que `getSupervisionIncidentDetail` já
 * usa desde a v3.5. **Nenhuma tabela nova, nenhuma segunda fonte de
 * verdade** — a timeline é uma PROJEÇÃO de leitura; `human_note` foi
 * deliberadamente OMITIDO do vocabulário (correio.md seção 2.2: notas só
 * se justificadas por 4 critérios, nenhum deles satisfeito nesta versão
 * — `agent_operational_incident_reviews.note` já cobre parcialmente o
 * caso de uso, então "não existe estrutura persistente adequada" é
 * falso; ver relatório de entrega).
 */
export const OPERATIONAL_INCIDENT_TIMELINE_EVENT_TYPES = [
  'incident_detected',
  'review_acknowledged',
  'review_status_changed',
  'assigned',
  'reassigned',
  'unassigned',
  'escalation_created',
  'follow_up_created',
] as const;
export type OperationalIncidentTimelineEventType = (typeof OPERATIONAL_INCIDENT_TIMELINE_EVENT_TYPES)[number];

export interface OperationalIncidentTimelineEvent {
  // Sempre `${fonte}:${id da linha de origem}` — nunca uma chave
  // sintética aleatória, rastreável de volta à linha real
  // (audit_logs/escalation/follow-up) que originou o evento.
  id: string;
  type: OperationalIncidentTimelineEventType;
  occurredAt: string;
  // `null` = ator não determinável (correio.md seção 11: "nunca inventar
  // usuário") — sempre o caso real para `escalation_created`/
  // `follow_up_created` (criados pelo sistema, `escalateSupervisorFinding`/
  // `createOrReopenFollowUpFromEscalation`, nunca por um humano
  // diretamente).
  actorUserId: number | null;
  from?: string | number | null;
  to?: string | number | null;
  metadata?: Record<string, unknown>;
}

export interface OperationalIncidentTimeline {
  incidentAuditLogId: number;
  events: OperationalIncidentTimelineEvent[];
}

// Rank menor = mais cedo no desempate. Usado SÓ quando `occurredAt`
// empata exatamente (correio.md seção 5: "não depender da ordem
// incidental retornada pelo Postgres... documentar o critério
// escolhido") — ordem causal esperada quando dois eventos de fontes
// diferentes compartilham o mesmo timestamp.
const TIMELINE_EVENT_TYPE_RANK: Record<OperationalIncidentTimelineEventType, number> = {
  incident_detected: 0,
  assigned: 1,
  reassigned: 1,
  unassigned: 1,
  review_acknowledged: 2,
  review_status_changed: 2,
  escalation_created: 3,
  follow_up_created: 4,
};

// Desempate final, estável: o número da própria linha de origem (sufixo
// numérico do `id`, ex.: "review:123" → 123) — cada fonte já tem uma PK
// serial monotonicamente crescente, então isto é sempre determinístico e
// reproduzível mesmo quando dois eventos da MESMA fonte empatam
// (correio.md: "identificador persistente... já existente").
function timelineSortIdSuffix(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

// Exportada para teste unitário puro (sem banco) — ordenação
// determinística é uma das invariantes exigidas pelo correio.md (seção 5,
// item 10 dos testes obrigatórios).
export function sortOperationalIncidentTimelineEvents(events: OperationalIncidentTimelineEvent[]): OperationalIncidentTimelineEvent[] {
  return [...events].sort((a, b) => {
    const timeDiff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    const rankDiff = TIMELINE_EVENT_TYPE_RANK[a.type] - TIMELINE_EVENT_TYPE_RANK[b.type];
    if (rankDiff !== 0) return rankDiff;
    return timelineSortIdSuffix(a.id) - timelineSortIdSuffix(b.id);
  });
}

export interface SupervisionIncidentDetail extends SupervisionIncidentSummary {
  problem: string;
  reason: string | null;
  errorMessage: string | null;
  escalation: {
    id: number;
    status: string;
    severity: string;
    reason: string;
    targetAgentId: number | null;
    targetUserId: number | null;
    createdAt: string;
  } | null;
  auditRefs: { id: number; action: string; createdAt: string }[];
  // Agentes v3.6 — dimensão SEPARADA (correio.md seção 8: "o diálogo de
  // detalhe deve mostrar claramente duas dimensões diferentes: Resultado
  // operacional / Review humano. Nunca misturá-las"). `reviewStatus`
  // (herdado de SupervisionIncidentSummary) é só o status; aqui o objeto
  // completo (quem revisou, quando, nota) para o "Incident Review".
  review: IncidentReview;
  // Agentes v4.0 — "o que aconteceu, em que ordem, e quem fez" (correio.md
  // "25. Diretriz principal"). Embutida no MESMO endpoint de detalhe
  // (decisão documentada no relatório de entrega) — nunca um endpoint
  // dedicado adicional, já que o diálogo de detalhe sempre carrega os
  // dois juntos.
  timeline: OperationalIncidentTimelineEvent[];
  // Agentes v4.1 — SOBRESCREVE `SupervisionIncidentSummary.sla` (a
  // aproximação de lista) com os valores EXATOS: `acknowledgedAt`
  // derivado da transição real unreviewed→acknowledged (histórico de
  // review, v3.6) e `lastActivityAt` derivado do último evento da
  // timeline completa (v4.0) — ambos baratos o bastante só porque este
  // é o detalhe de UM incidente, nunca uma lista.
  sla: OperationalIncidentSlaDetail;
}

const REVIEW_CHANGED_ACTION = 'agents.operations.incident_review.changed';
const ASSIGNMENT_CHANGED_ACTIONS = ['agents.operations.incident.assigned', 'agents.operations.incident.reassigned', 'agents.operations.incident.unassigned'] as const;

export async function getSupervisionIncidentDetail(auditLogId: number, now: Date = new Date()): Promise<SupervisionIncidentDetail | null> {
  const [row] = await db
    .select({ id: auditLogs.id, userId: auditLogs.userId, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.id, auditLogId), eq(auditLogs.action, 'agents.operations.incident.detected')))
    .limit(1);

  if (!row) return null;

  const [summary] = await enrichIncidentRows([row], now);
  if (!summary) return null;

  const incidentId = `${summary.incidentType}:${summary.entityType}:${summary.entityId}`;

  const [relatedAudits, [escalationRow], review, reviewAudits, assignmentAudits, slaMinutesBySeverity] = await Promise.all([
    db
      .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, summary.entityType), eq(auditLogs.entityId, summary.entityId), gte(auditLogs.createdAt, row.createdAt)))
      .orderBy(auditLogs.createdAt)
      .limit(20),

    db
      .select()
      .from(agentOperationalEscalations)
      .where(eq(sql<string>`${agentOperationalEscalations.metadata}->>'incidentId'`, incidentId))
      .limit(1),

    // Objeto completo do review (quem/quando/nota) — `summary.reviewStatus`
    // já veio de `enrichIncidentRows`, mas o detalhe (v3.6, correio.md
    // seção 3/9) precisa do resto. Chamada única e dedicada, aceitável
    // aqui: endpoint de UM item, nunca de lista (nenhum N+1).
    getIncidentReview(auditLogId),

    // Agentes v4.0 — histórico COMPLETO de transições de review (v3.6 já
    // audita toda chamada, com ator/timestamp/status anterior-novo reais
    // — nunca inferidos). Filtrado por `incidentAuditLogId` no metadata,
    // a MESMA chave exata usada por `upsertIncidentReview`/
    // `getIncidentReviewsByAuditLogIds` — nenhuma correlação heurística.
    db
      .select({ id: auditLogs.id, userId: auditLogs.userId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, REVIEW_CHANGED_ACTION), eq(sql<string>`${auditLogs.metadata}->>'incidentAuditLogId'`, String(auditLogId))))
      .orderBy(auditLogs.createdAt),

    // Agentes v4.0 — histórico COMPLETO de assign/reassign/unassign (v3.8
    // já audita toda chamada) — mesma chave exata `incidentAuditLogId`.
    db
      .select({ id: auditLogs.id, action: auditLogs.action, userId: auditLogs.userId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(inArray(auditLogs.action, [...ASSIGNMENT_CHANGED_ACTIONS]), eq(sql<string>`${auditLogs.metadata}->>'incidentAuditLogId'`, String(auditLogId))))
      .orderBy(auditLogs.createdAt),

    // Agentes v4.1 — mesma config já lida por `enrichIncidentRows`
    // acima, relida aqui só porque `getOperationalSlaMinutesBySeverity`
    // não devolve o valor usado internamente; UMA query extra, aceitável
    // no detalhe de um item só (mesmo racional de `getIncidentReview`).
    getOperationalSlaMinutesBySeverity(),
  ]);

  // Agentes v4.0 — FollowUps ligados ao incidente só existem via a MESMA
  // Escalation já encontrada acima (`escalationId`, FK real) — vínculo
  // determinístico, nunca por proximidade temporal/texto (correio.md
  // seção 6.6: "só integrar quando houver vínculo determinístico").
  // Consulta condicional (só quando há escalation) — nunca uma query a
  // mais quando não há o que buscar.
  const followUpRows = escalationRow
    ? await db
        .select({ id: agentOperationalFollowUps.id, priority: agentOperationalFollowUps.priority, assignedUserId: agentOperationalFollowUps.assignedUserId, createdAt: agentOperationalFollowUps.createdAt })
        .from(agentOperationalFollowUps)
        .where(eq(agentOperationalFollowUps.escalationId, escalationRow.id))
        .orderBy(agentOperationalFollowUps.createdAt)
    : [];

  const outcomeAudit = relatedAudits.find((audit) => {
    const auditMetadata = audit.metadata as { incidentType?: string } | null;
    return (OUTCOME_AUDIT_ACTIONS as readonly string[]).includes(audit.action) && auditMetadata?.incidentType === summary.incidentType && audit.id !== row.id;
  });

  const outcomeMetadata = outcomeAudit?.metadata as { reason?: string; message?: string } | null;

  const timelineEvents: OperationalIncidentTimelineEvent[] = [
    { id: `detected:${row.id}`, type: 'incident_detected', occurredAt: row.createdAt.toISOString(), actorUserId: row.userId },
  ];

  for (const audit of reviewAudits) {
    const metadata = audit.metadata as { previousStatus?: IncidentReviewStatusOrUnreviewed; newStatus?: IncidentReviewStatusOrUnreviewed; hasNote?: boolean };
    const isFirstAcknowledgement = metadata.previousStatus === 'unreviewed' && metadata.newStatus === 'acknowledged';
    timelineEvents.push({
      id: `review:${audit.id}`,
      type: isFirstAcknowledgement ? 'review_acknowledged' : 'review_status_changed',
      occurredAt: audit.createdAt.toISOString(),
      actorUserId: audit.userId,
      from: metadata.previousStatus ?? null,
      to: metadata.newStatus ?? null,
      metadata: { hasNote: metadata.hasNote ?? false },
    });
  }

  for (const audit of assignmentAudits) {
    const metadata = audit.metadata as { previousAssigneeUserId?: number | null; assigneeUserId?: number | null };
    const type: OperationalIncidentTimelineEventType = metadata.assigneeUserId == null ? 'unassigned' : metadata.previousAssigneeUserId == null ? 'assigned' : 'reassigned';
    timelineEvents.push({
      id: `assignment:${audit.id}`,
      type,
      occurredAt: audit.createdAt.toISOString(),
      actorUserId: audit.userId,
      from: metadata.previousAssigneeUserId ?? null,
      to: metadata.assigneeUserId ?? null,
    });
  }

  if (escalationRow) {
    timelineEvents.push({
      id: `escalation:${escalationRow.id}`,
      type: 'escalation_created',
      occurredAt: escalationRow.createdAt.toISOString(),
      // Escalations são criadas por `escalateSupervisorFinding`
      // (sistema, v2.6) — nunca por um humano diretamente. `null`
      // reflete isso com precisão, nunca inventado.
      actorUserId: null,
      metadata: { escalationId: escalationRow.id, severity: escalationRow.severity, targetAgentId: escalationRow.targetAgentId, targetUserId: escalationRow.targetUserId },
    });
  }

  for (const followUp of followUpRows) {
    timelineEvents.push({
      id: `followup:${followUp.id}`,
      type: 'follow_up_created',
      occurredAt: followUp.createdAt.toISOString(),
      // Mesmo racional de `escalation_created` acima — criado por
      // `createOrReopenFollowUpFromEscalation` (sistema, v2.7).
      actorUserId: null,
      metadata: { followUpId: followUp.id, priority: followUp.priority, assignedUserId: followUp.assignedUserId },
    });
  }

  const sortedTimeline = sortOperationalIncidentTimelineEvents(timelineEvents);

  // Agentes v4.1 — valores EXATOS para o detalhe (correio.md seção 8):
  // `lastActivityAt` é o último evento da timeline COMPLETA (não a
  // aproximação de `enrichIncidentRows`); `acknowledgedAt` é a transição
  // REAL unreviewed→acknowledged (não inferida do estado corrente,
  // correio.md seção 6.2/7: "não inferir... quando o histórico fornecer
  // a transição exata").
  const lastActivityAt = sortedTimeline.length > 0 ? new Date(sortedTimeline[sortedTimeline.length - 1]!.occurredAt) : row.createdAt;
  const acknowledgedEvent = sortedTimeline.find((event) => event.type === 'review_acknowledged');
  const acknowledgedAt = acknowledgedEvent ? new Date(acknowledgedEvent.occurredAt) : null;

  const isCompleted = summary.reviewStatus === 'resolved' || summary.reviewStatus === 'dismissed';
  const slaBase = computeIncidentSla({
    severity: summary.severity,
    detectedAt: row.createdAt,
    reviewStatus: summary.reviewStatus,
    closedAt: isCompleted && review?.reviewedAt ? new Date(review.reviewedAt) : null,
    assignedAt: summary.assignment ? new Date(summary.assignment.assignedAt) : null,
    lastActivityAt,
    now,
    slaMinutesBySeverity,
  });
  const sla: OperationalIncidentSlaDetail = {
    ...slaBase,
    acknowledgedAt: acknowledgedAt ? acknowledgedAt.toISOString() : null,
    acknowledgementSeconds: acknowledgedAt ? Math.max(0, Math.round((acknowledgedAt.getTime() - row.createdAt.getTime()) / 1000)) : null,
  };

  return {
    ...summary,
    problem: (row.metadata as { reason?: string } | null)?.reason ?? `${summary.incidentType} em ${summary.entityType} #${summary.entityId}.`,
    reason: outcomeMetadata?.reason ?? null,
    errorMessage: outcomeAudit?.action === 'agents.operations.incident.failed' ? (outcomeMetadata?.message ?? null) : null,
    escalation: escalationRow
      ? {
          id: escalationRow.id,
          status: escalationRow.status,
          severity: escalationRow.severity,
          reason: escalationRow.reason,
          targetAgentId: escalationRow.targetAgentId,
          targetUserId: escalationRow.targetUserId,
          createdAt: escalationRow.createdAt.toISOString(),
        }
      : null,
    auditRefs: relatedAudits.filter((audit) => audit.id !== row.id).map((audit) => ({ id: audit.id, action: audit.action, createdAt: audit.createdAt.toISOString() })),
    // Não-nulo garantido: `row` já foi confirmado acima como um
    // `incident.detected` válido — a mesma condição que faria
    // `getIncidentReview` devolver `null`.
    review: review!,
    timeline: sortedTimeline,
    sla,
  };
}

/**
 * Agentes v3.7 (correio.md "Operational Incident Review Queue & Attention
 * Management") — fila operacional "Needs Attention". Projeção pura sobre
 * `enrichIncidentRows` (v3.5/v3.6, já batched) — NENHUM novo conceito de
 * incidente, NENHUMA tabela nova (correio.md "Descoberta obrigatória":
 * `audit_logs` + `agent_operational_incident_reviews` + dados já
 * derivados pela v3.5 bastam — ver relatório de entrega em executed.md
 * para a análise completa).
 */
export interface AttentionQueueItem extends SupervisionIncidentSummary {
  // Aging calculado em tempo de leitura (correio.md "Aging": "não
  // persistir contador, cronômetro nem timestamp artificial") a partir de
  // `detectedAt`, o timestamp canônico já existente.
  ageMs: number;
  agingBucket: AgingBucket;
  // Só presente quando `reviewStatus === 'acknowledged'` (correio.md:
  // "se houver acknowledged, pode ser útil expor... tempo desde o último
  // review/acknowledgement") — tempo decorrido desde `review.reviewedAt`,
  // NUNCA um segundo timestamp persistido (deriva do mesmo objeto de
  // review já lido em lote por `getIncidentReviewsByAuditLogIds`).
  sinceReviewMs: number | null;
  sinceReviewBucket: AgingBucket | null;
  // Explica, de forma determinística e auditável, por que o item está na
  // fila e nesta posição (correio.md "Frontend": "por que aquele
  // incidente aparece acima de outro") — nunca um score opaco.
  attentionReasons: AttentionReason[];
}

export const ATTENTION_REASONS = ['unreviewed', 'acknowledged_pending', 'recurring', 'high_severity', 'aging'] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export interface ListAttentionQueueParams {
  page: number;
  limit: number;
  dateFrom?: Date;
  dateTo?: Date;
  severity?: OperationalSeverity;
  incidentType?: OperationalIncidentType;
  outcome?: SupervisionOutcome;
  // Ausente = default da fila: exclui `resolved`/`dismissed` (correio.md
  // "Escopo funcional": "não devem aparecer por padrão"). Informado
  // explicitamente = filtro normal, INCLUSIVE para `resolved`/`dismissed`
  // (correio.md: "podem continuar acessíveis através dos filtros/histórico
  // quando aplicável" — mesmo parâmetro, nunca um segundo mecanismo de
  // filtro).
  reviewStatus?: IncidentReviewStatusOrUnreviewed;
  recurringOnly?: boolean;
  agingBucket?: AgingBucket;
  // Mesmo filtro de `listSupervisionIncidents` (v3.5) — reaproveitado
  // aqui não só por utilidade operacional (escopar a fila a um
  // agente/job específico), mas também porque filtra a query NA
  // BORDA (WHERE), reduzindo a janela de 500 linhas a um universo
  // menor quando o operador já sabe o que procura.
  entityType?: string;
  entityId?: string;
  // Agentes v3.8 (correio.md "Integração com Needs Attention", seção 13)
  // — "evitar criar outro endpoint apenas para 'My Incidents'; o mesmo
  // endpoint da fila deve ser reutilizado". `unassignedOnly` tem
  // precedência quando os dois vierem juntos (combinação sem sentido
  // prático, mas nunca deveria dar erro).
  assigneeUserId?: number;
  unassignedOnly?: boolean;
  // Relógio injetável (correio.md "Testes obrigatórios": "preferir relógio
  // controlável/injetável... em vez de sleeps reais") — default `new Date()`
  // em produção, fixo nos testes.
  now?: Date;
}

const DEFAULT_EXCLUDED_REVIEW_STATUSES: readonly IncidentReviewStatusOrUnreviewed[] = ['resolved', 'dismissed'];

// Rank menor = maior prioridade. Ordem lexicográfica documentada no
// correio.md ("Prioridade operacional"): severidade > recorrência >
// review pendente > aging > id (desempate estável).
const SEVERITY_RANK: Record<OperationalSeverity, number> = { critical: 0, warning: 1, info: 2 };
const REVIEW_PENDING_RANK: Record<IncidentReviewStatusOrUnreviewed, number> = { unreviewed: 0, acknowledged: 1, resolved: 2, dismissed: 3 };

function attentionReasonsFor(item: Pick<AttentionQueueItem, 'reviewStatus' | 'isRecurring' | 'severity' | 'agingBucket'>): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (item.reviewStatus === 'unreviewed') reasons.push('unreviewed');
  else if (item.reviewStatus === 'acknowledged') reasons.push('acknowledged_pending');
  if (item.isRecurring) reasons.push('recurring');
  if (item.severity === 'critical') reasons.push('high_severity');
  if (item.agingBucket === '4h-24h' || item.agingBucket === '>24h') reasons.push('aging');
  return reasons;
}

/**
 * Ordenação determinística/reproduzível/explicável (correio.md "Prioridade
 * operacional") — nunca LLM/IA/embeddings/score probabilístico. Regras
 * lexicográficas puras, cada uma um campo já exposto na resposta (nunca um
 * "score mágico" opaco):
 *
 * 1. severidade (critical > warning > info);
 * 2. recorrência (recorrente > não recorrente);
 * 3. review pendente (unreviewed > acknowledged > resolved > dismissed);
 * 4. aging (mais antigo primeiro);
 * 5. `auditLogId` ascendente — desempate estável e reproduzível (ids de
 *    `audit_logs` são monotonicamente crescentes com o tempo de detecção,
 *    então isto também é, na prática, "detectado primeiro primeiro").
 */
function compareAttentionPriority(a: AttentionQueueItem, b: AttentionQueueItem): number {
  const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severityDiff !== 0) return severityDiff;

  const recurrenceDiff = (b.isRecurring ? 1 : 0) - (a.isRecurring ? 1 : 0);
  if (recurrenceDiff !== 0) return recurrenceDiff;

  const reviewDiff = REVIEW_PENDING_RANK[a.reviewStatus] - REVIEW_PENDING_RANK[b.reviewStatus];
  if (reviewDiff !== 0) return reviewDiff;

  const ageDiff = b.ageMs - a.ageMs;
  if (ageDiff !== 0) return ageDiff;

  return a.auditLogId - b.auditLogId;
}

export async function listAttentionQueue(params: ListAttentionQueueParams): Promise<{ rows: AttentionQueueItem[]; total: number }> {
  const conditions: SQL[] = [eq(auditLogs.action, 'agents.operations.incident.detected')];
  if (params.dateFrom) conditions.push(gte(auditLogs.createdAt, params.dateFrom));
  if (params.dateTo) conditions.push(lte(auditLogs.createdAt, params.dateTo));
  if (params.severity) conditions.push(sql`${auditLogs.metadata}->>'severity' = ${params.severity}`);
  if (params.incidentType) conditions.push(sql`${auditLogs.metadata}->>'incidentType' = ${params.incidentType}`);
  if (params.entityType) conditions.push(eq(auditLogs.entityType, params.entityType));
  if (params.entityId) conditions.push(eq(auditLogs.entityId, params.entityId));

  const rows = await db
    .select({ id: auditLogs.id, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt))
    // Mesma janela pragmática de 500 linhas já documentada em
    // `listSupervisionIncidents` (v3.5/v3.6) para filtros/ordenação
    // pós-enriquecimento — toda a fila é sempre pós-enriquecimento (aging,
    // recorrência, outcome, review), então a janela se aplica sempre aqui,
    // não só condicionalmente. Suficiente para o volume operacional real
    // deste sistema; documentado como limitação conhecida.
    .limit(500);

  const now = params.now ?? new Date();

  // Uma query batched extra (não N+1) só para `reviewedAt` — `enrichIncidentRows`
  // já expõe `reviewStatus`, mas não o timestamp do review; precisamos dele
  // aqui para "tempo desde o último review" (correio.md "Aging"). Mesmo
  // `now` injetável repassado a `enrichIncidentRows` (v4.1) — aging/SLA
  // usam exatamente o mesmo relógio do resto desta função, nunca dois
  // "agoras" divergentes na mesma resposta.
  const [enriched, reviewsByAuditLogId] = await Promise.all([enrichIncidentRows(rows, now), getIncidentReviewsByAuditLogIds(rows.map((row) => row.id))]);

  let withAging: AttentionQueueItem[] = enriched.map((item) => {
    const ageMs = Math.max(0, now.getTime() - new Date(item.detectedAt).getTime());
    const review = reviewsByAuditLogId.get(item.auditLogId);
    const sinceReviewMs = review?.status === 'acknowledged' && review.reviewedAt ? Math.max(0, now.getTime() - new Date(review.reviewedAt).getTime()) : null;
    const agingBucket = agingBucketFromMs(ageMs);
    return {
      ...item,
      ageMs,
      agingBucket,
      sinceReviewMs,
      sinceReviewBucket: sinceReviewMs === null ? null : agingBucketFromMs(sinceReviewMs),
      attentionReasons: attentionReasonsFor({ reviewStatus: item.reviewStatus, isRecurring: item.isRecurring, severity: item.severity, agingBucket }),
    };
  });

  // Default da fila: exclui resolved/dismissed. Filtro explícito de
  // reviewStatus substitui o default (correio.md: "podem continuar
  // acessíveis através dos filtros" — mesmo parâmetro, nunca dois
  // mecanismos).
  if (params.reviewStatus) {
    withAging = withAging.filter((item) => item.reviewStatus === params.reviewStatus);
  } else {
    withAging = withAging.filter((item) => !DEFAULT_EXCLUDED_REVIEW_STATUSES.includes(item.reviewStatus));
  }
  if (params.outcome) withAging = withAging.filter((item) => item.outcome === params.outcome);
  if (params.recurringOnly) withAging = withAging.filter((item) => item.isRecurring);
  if (params.agingBucket) withAging = withAging.filter((item) => item.agingBucket === params.agingBucket);
  if (params.unassignedOnly) withAging = withAging.filter((item) => item.assignment === null);
  else if (params.assigneeUserId !== undefined) withAging = withAging.filter((item) => item.assignment?.assigneeUserId === params.assigneeUserId);

  withAging.sort(compareAttentionPriority);

  const total = withAging.length;
  const page = withAging.slice((params.page - 1) * params.limit, params.page * params.limit);

  return { rows: page, total };
}

/**
 * Agentes v3.9 (correio.md "Operational Ownership Workload & Human
 * Coordination Views") — leitura consolidada de ownership. `workload`
 * significa exclusivamente "quantidade observada de incidentes
 * atualmente atribuídos dentro da população operacional ativa" (correio.md
 * seção 2) — NUNCA capacidade/produtividade/desempenho/recomendação;
 * nenhuma classificação como "sobrecarregado" existe neste módulo.
 *
 * **Zero migration** (correio.md seção 1: "a expectativa arquitetural é
 * zero migration"): tudo abaixo é derivado em tempo de leitura de
 * `audit_logs` + `agent_operational_incident_reviews` (v3.6) +
 * `agent_operational_incident_assignments` (v3.8) — nenhum contador
 * persistido, nenhuma tabela nova.
 *
 * **População** (correio.md seção 3: "reutilizar a mesma definição
 * operacional da fila Needs Attention da v3.7... não criar uma segunda
 * regra"): EXATAMENTE `DEFAULT_EXCLUDED_REVIEW_STATUSES` (a mesma
 * constante usada pelo default de `listAttentionQueue` acima) — um
 * incidente `resolved`/`dismissed` nunca entra na população ativa, mas
 * seu assignment continua persistido normalmente em
 * `agent_operational_incident_assignments` (nunca destruído por review).
 *
 * **Por que agregação SQL em vez de reaproveitar `enrichIncidentRows`
 * linha-a-linha** (correio.md seção 8: "proibido... agregação deve ser
 * batched/set-based"): `enrichIncidentRows`/`listAttentionQueue` usam uma
 * janela de 500 linhas (limitação pragmática já documentada, adequada
 * para PAGINAÇÃO de uma fila que um humano rola manualmente) — usar essa
 * mesma janela aqui subcontaria o workload real sempre que houvesse mais
 * de 500 incidentes ativos no sistema (cenário real observado neste
 * ambiente: dezenas de milhares de incidentes/dia). A "mesma definição
 * operacional" reaproveitada aqui é a REGRA de população (severidade dos
 * status excluídos), nunca a implementação paginada — duas agregações
 * `GROUP BY` no Postgres (nenhum `enrichIncidentRows`, nenhum
 * `listAttentionQueue`) resolvem o total real sem carregar uma linha por
 * incidente no Node, e o número de queries nunca cresce com o volume de
 * incidentes (testado explicitamente).
 */
export interface OperationalOwnershipWorkload {
  totals: { active: number; assigned: number; unassigned: number };
  assignees: {
    userId: number;
    incidentCount: number;
    bySeverity: Record<OperationalSeverity, number>;
    // Só `unreviewed`/`acknowledged` — a população ativa (acima) já
    // exclui `resolved`/`dismissed` por definição, então nenhum incidente
    // desta agregação jamais teria um desses dois status (correio.md:
    // "adaptar os valores exatos... não inventar estados que não
    // existam").
    byReviewStatus: { unreviewed: number; acknowledged: number };
  }[];
}

// Mesma expressão SQL (LEFT JOIN + coalesce) já usada por
// `getSupervisionOverview` para sintetizar `reviewStatus` — reescrita
// aqui porque cada uso precisa aparecer em cláusulas SQL diferentes
// (SELECT/WHERE/GROUP BY), mesmo idioma de repetição já usado ali.
const ACTIVE_REVIEW_STATUS_EXPR = sql<string>`coalesce(${agentOperationalIncidentReviews.status}, 'unreviewed')`;
// Literalmente a MESMA constante usada pelo default de `listAttentionQueue`
// acima (`DEFAULT_EXCLUDED_REVIEW_STATUSES`) — nunca uma segunda lista
// hardcoded de status excluídos, garantindo que a população do workload
// não possa divergir silenciosamente da população default da fila Needs
// Attention (correio.md seção 3).
const ACTIVE_REVIEW_STATUS_FILTER = sql`${ACTIVE_REVIEW_STATUS_EXPR} not in (${sql.join(
  DEFAULT_EXCLUDED_REVIEW_STATUSES.map((status) => sql`${status}`),
  sql`, `,
)})`;

export async function getOperationalOwnershipWorkload(): Promise<OperationalOwnershipWorkload> {
  const incidentDetected = eq(auditLogs.action, 'agents.operations.incident.detected');

  const [[totalsRow], assigneeRows] = await Promise.all([
    // Query 1/2 — totais (active/assigned/unassigned). Um único `SELECT`
    // agregado, `count(*) filter`, mesmo idioma de control-center-service.ts
    // e de getJobsSummary (routes/agents/operations.ts) — nunca um loop
    // no Node.
    db
      .select({
        active: count(),
        assigned: sql<number>`count(*) filter (where ${agentOperationalIncidentAssignments.assigneeUserId} is not null)`,
        unassigned: sql<number>`count(*) filter (where ${agentOperationalIncidentAssignments.assigneeUserId} is null)`,
      })
      .from(auditLogs)
      .leftJoin(agentOperationalIncidentReviews, eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogs.id))
      .leftJoin(agentOperationalIncidentAssignments, eq(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogs.id))
      .where(and(incidentDetected, ACTIVE_REVIEW_STATUS_FILTER)),

    // Query 2/2 — quebra por responsável × severidade × reviewStatus.
    // `INNER JOIN` com assignments (só incidentes JÁ atribuídos entram
    // aqui — "unassigned" já foi contado acima) agrupado em UMA query —
    // o número de linhas devolvidas é (nº de responsáveis × severidades ×
    // review statuses), nunca uma linha por incidente, nunca uma query
    // por responsável.
    db
      .select({
        assigneeUserId: agentOperationalIncidentAssignments.assigneeUserId,
        severity: sql<string>`${auditLogs.metadata}->>'severity'`,
        reviewStatus: ACTIVE_REVIEW_STATUS_EXPR,
        total: count(),
      })
      .from(auditLogs)
      .innerJoin(agentOperationalIncidentAssignments, eq(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogs.id))
      .leftJoin(agentOperationalIncidentReviews, eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogs.id))
      .where(and(incidentDetected, ACTIVE_REVIEW_STATUS_FILTER))
      .groupBy(agentOperationalIncidentAssignments.assigneeUserId, sql`${auditLogs.metadata}->>'severity'`, ACTIVE_REVIEW_STATUS_EXPR),
  ]);

  const emptyBySeverity = (): Record<OperationalSeverity, number> => Object.fromEntries(OPERATIONAL_SEVERITIES.map((severity) => [severity, 0])) as Record<OperationalSeverity, number>;

  const assigneeMap = new Map<number, OperationalOwnershipWorkload['assignees'][number]>();
  for (const row of assigneeRows) {
    const userId = row.assigneeUserId; // NOT NULL garantido pelo INNER JOIN acima.
    const total = Number(row.total);

    let entry = assigneeMap.get(userId);
    if (!entry) {
      entry = { userId, incidentCount: 0, bySeverity: emptyBySeverity(), byReviewStatus: { unreviewed: 0, acknowledged: 0 } };
      assigneeMap.set(userId, entry);
    }

    entry.incidentCount += total;
    if ((OPERATIONAL_SEVERITIES as readonly string[]).includes(row.severity)) {
      entry.bySeverity[row.severity as OperationalSeverity] += total;
    }
    if (row.reviewStatus === 'unreviewed' || row.reviewStatus === 'acknowledged') {
      entry.byReviewStatus[row.reviewStatus] += total;
    }
  }

  // Ordem determinística — mais incidentes ativos primeiro, `userId`
  // ascendente como desempate estável (mesmo princípio de
  // `compareAttentionPriority`, nunca uma ordem arbitrária do banco).
  const assignees = Array.from(assigneeMap.values()).sort((a, b) => b.incidentCount - a.incidentCount || a.userId - b.userId);

  return {
    totals: { active: Number(totalsRow?.active ?? 0), assigned: Number(totalsRow?.assigned ?? 0), unassigned: Number(totalsRow?.unassigned ?? 0) },
    assignees,
  };
}

export interface RecurringIncident {
  incidentType: OperationalIncidentType;
  entityType: string;
  entityId: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Recorrência (correio.md seção 4): mesma chave (`incidentType` +
 * `entityType` + `entityId` — exatamente `incident.id`, ver docblock do
 * arquivo) detectada em mais de um scan. Determinístico, auditável (cada
 * ocorrência é um audit log real, nenhuma inferência), nenhuma
 * classificação por IA.
 */
export async function listRecurringIncidents(params: SupervisionInsightsFilterParams = {}): Promise<RecurringIncident[]> {
  const conditions: SQL[] = [eq(auditLogs.action, 'agents.operations.incident.detected')];
  if (params.dateFrom) conditions.push(gte(auditLogs.createdAt, params.dateFrom));
  if (params.dateTo) conditions.push(lte(auditLogs.createdAt, params.dateTo));

  const rows = await db
    .select({
      incidentType: sql<string>`${auditLogs.metadata}->>'incidentType'`,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      occurrences: count(),
      firstSeenAt: sql<Date>`min(${auditLogs.createdAt})`,
      lastSeenAt: sql<Date>`max(${auditLogs.createdAt})`,
    })
    .from(auditLogs)
    .where(and(...conditions))
    .groupBy(sql`${auditLogs.metadata}->>'incidentType'`, auditLogs.entityType, auditLogs.entityId)
    .having(sql`count(*) > 1`)
    .orderBy(desc(count()));

  return rows.map((row) => ({
    incidentType: (row.incidentType ?? 'operational_degradation') as OperationalIncidentType,
    entityType: row.entityType ?? '',
    entityId: row.entityId ?? '',
    occurrences: Number(row.occurrences),
    firstSeenAt: new Date(row.firstSeenAt).toISOString(),
    lastSeenAt: new Date(row.lastSeenAt).toISOString(),
  }));
}

// Reexportado para uso em schemas.ts (vocabulário fechado dos filtros).
export { OPERATIONAL_INCIDENT_TYPES, OPERATIONAL_RESPONSES, OPERATIONAL_SEVERITIES };
