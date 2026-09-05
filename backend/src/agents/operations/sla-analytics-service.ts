import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentReviews, auditLogs } from '../../db/schema/index.js';
import { OPERATIONAL_SEVERITIES } from './health-types.js';
import type { OperationalSeverity } from './health-types.js';
import { getFirstAcknowledgedAtByAuditLogIds } from './incident-review-service.js';
import { computeIncidentSla } from './supervision-insights-service.js';
import { getOperationalSlaMinutesBySeverity } from './sla-settings.js';
import type { OperationalSlaMinutesBySeverity } from './sla-settings.js';

/**
 * Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
 * Visibility") — camada de LEITURA agregada sobre os mesmos dados
 * canônicos já usados pela v3.5/v3.6/v3.8/v4.1
 * (`agents.operations.incident.detected` em `audit_logs` +
 * `agent_operational_incident_reviews` + o próprio audit trail de
 * assignment/review, v3.6/v3.8) — nenhuma tabela nova, nenhum valor
 * derivado persistido (correio.md seção 2).
 *
 * ## Descoberta (correio.md seção 1 — respostas obrigatórias)
 *
 * 1. Os dados necessários já existem? Sim — nenhum estado novo. Todas as
 *    métricas são deriváveis de `audit_logs` (identidade do incidente +
 *    `detectedAt`) e `agent_operational_incident_reviews`
 *    (`status`/`reviewedAt` = fechamento real, mesma premissa já usada por
 *    `computeIncidentSla`/`enrichIncidentRows` desde a v4.1).
 * 2. Nenhum indicador exige estado novo persistido — breach rate,
 *    médias/medianas, série temporal e breakdowns são só agregações em
 *    tempo de leitura sobre o que já existe (seção 2 desta versão proíbe
 *    persistir qualquer um deles).
 * 3. Nenhuma migration criada.
 * 4. Timestamps canônicos:
 *    - detecção → `audit_logs.created_at` do `incident.detected`
 *      (identidade única do incidente, mesma de toda `agents/operations/*`
 *      desde a v3.5);
 *    - acknowledgement → primeira transição real
 *      `unreviewed → acknowledged` no audit trail de review (v3.6),
 *      resolvida em LOTE por `getFirstAcknowledgedAtByAuditLogIds`
 *      (NUNCA inferida do status corrente — correio.md seção 6);
 *    - assignment (para o breakdown por responsável, seção 10) → o
 *      audit trail de assign/reassign/unassign (v3.8), reconstruído para
 *      encontrar quem estava atribuído NO MOMENTO do fechamento (ver
 *      `resolveAssigneeAtClose` abaixo) — nunca o assignment CORRENTE
 *      (`agent_operational_incident_assignments`), que pode ter sido
 *      alterado depois do incidente já fechado;
 *    - fechamento → `agent_operational_incident_reviews.reviewed_at`
 *      quando `status` é `resolved`/`dismissed` (mesma premissa de
 *      `enrichIncidentRows`/`getSupervisionIncidentDetail`, v4.1: o campo
 *      é sempre reescrito na ÚLTIMA transição, então quando o status
 *      corrente é um dos dois terminais, `reviewed_at` É o timestamp real
 *      dessa transição);
 *    - deadline → `computeIncidentSla` (v4.1), a MESMA fórmula
 *      (`detectedAt + slaMinutesBySeverity[severity]`), nunca uma segunda
 *      política de prazo reimplementada aqui.
 * 5. Sim — dado os timestamps acima, todo indicador desta versão é
 *    calculável diretamente sobre os dados existentes, sem reconstrução
 *    heurística.
 * 6. Volume: este é um sistema operacional interno de uma agência
 *    (mesma escala já assumida por `listSupervisionIncidents`'s janela de
 *    500 linhas, v3.6/v3.7) — carregar todos os incidentes de um período
 *    numa consulta agregada e computar médias/medianas em memória é
 *    seguro nesta escala; documentado como limitação conhecida caso o
 *    volume real um dia justifique agregação 100% em SQL.
 * 7. Risco de N+1: eliminado por design — nenhuma query depende da
 *    quantidade de incidentes retornados (ver "Anti-N+1" abaixo: exatas
 *    6 queries, sempre, independente do volume). Testado explicitamente
 *    em `sla-analytics.integration.test.ts`.
 * 8. Nenhum indicador desta versão exige reconstrução histórica alheia ao
 *    que v3.6/v3.8 já auditam — a própria "reconstrução" do assignee no
 *    fechamento (seção 10) já É uma leitura de `audit_logs`, não um novo
 *    tipo de evento.
 * 9. Diferença entre métricas de abertos e fechados: `incidents.detected`/
 *    `incidents.open`/`bySeverity[*].detected` são escopados por
 *    `detectedAt` (coorte de ENTRADA); `incidents.closed`/`sla.*`/
 *    `resolution.*`/`bySeverity[*].closed|withinSla|outsideSla|breachRate`
 *    são escopados por `closedAt` (coorte de SAÍDA) — um incidente
 *    detectado ANTES do período mas fechado DENTRO dele entra nas
 *    métricas de fechamento, não nas de entrada, e vice-versa (correio.md
 *    seção 3). `openSla` (seção 13) é uma FOTOGRAFIA atual, deliberadamente
 *    independente do período pedido — ver docblock de `getOpenSlaSnapshot`.
 * 10. `acknowledgementSeconds`/`resolutionSeconds` seriam semanticamente
 *     incorretos sem `from`/`to` explícitos: sem um intervalo, "tempo
 *     médio de acknowledgement" misturaria incidentes de qualquer época,
 *     tornando a tendência ao longo do tempo (seção 12) impossível de
 *     interpretar. Por isso o endpoint sempre resolve um período explícito
 *     (default de 7 dias quando omitido — mesmo padrão já usado por
 *     `GET /operations/summary`, v1.6) e o devolve em `period` na resposta.
 */

// -----------------------------------------------------------------------
// Funções puras de agregação (correio.md seção 8) — sem I/O, testadas
// isoladamente em sla-analytics.test.ts.
// -----------------------------------------------------------------------

/**
 * Média aritmética, arredondada ao segundo inteiro mais próximo (o
 * contrato usa segundos inteiros — seção 8: "não usar arredondamento
 * silencioso"; aqui o arredondamento é deliberado e documentado, nunca
 * omitido: timestamps têm precisão de milissegundos, mas nenhuma métrica
 * desta versão precisa de sub-segundo).
 */
export function computeMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round(sum / values.length);
}

/**
 * Mediana — obrigatória (correio.md seção 8: "incidentes operacionais
 * podem ter distribuições com outliers e a média isolada pode ser
 * enganosa"). Par → média dos dois centrais (arredondada, mesmo racional
 * de `computeMean`); ímpar → o valor central exato.
 */
export function computeMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * `completedOutsideSla / (completedWithinSla + completedOutsideSla)`
 * (correio.md seção 5) — `null` (nunca `NaN`/`Infinity`/`0` arbitrário)
 * quando não há incidentes encerrados com SLA válido no período.
 */
export function computeBreachRate(withinSla: number, outsideSla: number): number | null {
  const denominator = withinSla + outsideSla;
  if (denominator === 0) return null;
  return outsideSla / denominator;
}

// -----------------------------------------------------------------------
// Contratos (correio.md seção 4/9/10/12/13)
// -----------------------------------------------------------------------

export interface OperationalSlaDurationStats {
  count: number;
  averageSeconds: number | null;
  medianSeconds: number | null;
}

export interface OperationalSlaSeverityBreakdown {
  detected: number;
  closed: number;
  withinSla: number;
  outsideSla: number;
  breachRate: number | null;
  // Agentes v4.2 (correio.md seção 9: "se for simples e sem duplicação
  // excessiva, incluir também") — reaproveita as MESMAS arrays de
  // segundos já calculadas para o total geral, apenas filtradas por
  // severidade; nenhuma query adicional.
  acknowledgement: { averageSeconds: number | null; medianSeconds: number | null };
  resolution: { averageSeconds: number | null; medianSeconds: number | null };
}

export interface OperationalSlaTrendPoint {
  date: string;
  detected: number;
  closed: number;
  withinSla: number;
  outsideSla: number;
}

/**
 * Agentes v4.2 (correio.md seção 10) — `userId` é `number` (não `string`,
 * como no exemplo conceitual do correio.md): convenção já estabelecida
 * por TODO o resto do módulo (`assigneeUserId`/`reviewedBy` são sempre
 * `number`, nunca `string`) — nenhuma segunda convenção de id introduzida
 * aqui. `displayName` é sempre `null`: a resolução de nome de usuário é
 * deliberadamente deixada para o frontend via `useUsersDirectory` — o
 * MESMO padrão já documentado em
 * `SupervisionIncidentSummary.assignment` (supervision-insights-service.ts,
 * v3.8): "evita uma segunda estratégia de resolução de nomes e um
 * segundo join batched só para isso".
 */
export interface OperationalSlaAssigneeAnalytics {
  userId: number;
  displayName: string | null;
  closed: number;
  withinSla: number;
  outsideSla: number;
  breachRate: number | null;
  averageResolutionSeconds: number | null;
  medianResolutionSeconds: number | null;
}

export interface OperationalSlaAnalytics {
  period: { from: string; to: string };
  incidents: { detected: number; closed: number; open: number };
  sla: { completedWithinSla: number; completedOutsideSla: number; breachRate: number | null };
  acknowledgement: OperationalSlaDurationStats;
  resolution: OperationalSlaDurationStats;
  bySeverity: Record<OperationalSeverity, OperationalSlaSeverityBreakdown>;
  // Agentes v4.2 (correio.md seção 13) — fotografia CORRENTE, SEPARADA do
  // breach rate histórico acima (`sla.breachRate`). Ver
  // `getOpenSlaSnapshot` — deliberadamente não escopada por `period`.
  openSla: { withinSla: number; warning: number; breached: number };
  trend: OperationalSlaTrendPoint[];
  // Agentes v4.2 (correio.md seção 10) — só incidentes cujo responsável
  // NO MOMENTO DO FECHAMENTO é inequívoco (ver `resolveAssigneeAtClose`).
  // Nunca ordenado por desempenho (correio.md seção 11: "não transformar
  // em score de pessoas") — ordem estável por `userId` ascendente.
  byAssignee: OperationalSlaAssigneeAnalytics[];
}

export interface GetOperationalSlaAnalyticsParams {
  from: Date;
  to: Date;
  severity?: OperationalSeverity;
}

const INCIDENT_DETECTED_ACTION = 'agents.operations.incident.detected';
const CLOSED_REVIEW_STATUSES = ['resolved', 'dismissed'] as const;
const ASSIGNMENT_CHANGED_ACTIONS = ['agents.operations.incident.assigned', 'agents.operations.incident.reassigned', 'agents.operations.incident.unassigned'] as const;

// Trend diária (correio.md seção 12: "não criar engine genérico de time
// series") — teto defensivo de pontos para nunca devolver um array sem
// limite prático quando `from`/`to` cobre um intervalo muito grande (este
// endpoint não é um relatório histórico plurianual).
const MAX_TREND_POINTS = 366;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function emptySeverityRecord<T>(factory: () => T): Record<OperationalSeverity, T> {
  return Object.fromEntries(OPERATIONAL_SEVERITIES.map((severity) => [severity, factory()])) as Record<OperationalSeverity, T>;
}

interface DetectedRow {
  id: number;
  detectedAt: Date;
  severity: OperationalSeverity;
  reviewStatus: 'unreviewed' | 'acknowledged' | 'resolved' | 'dismissed';
}

interface ClosedRow {
  id: number;
  detectedAt: Date;
  severity: OperationalSeverity;
  closedAt: Date;
}

function severityConditionOrUndefined(severity: OperationalSeverity | undefined) {
  return severity ? sql`${auditLogs.metadata}->>'severity' = ${severity}` : undefined;
}

/**
 * Coorte de ENTRADA (correio.md seção 3) — todo incidente detectado no
 * período, independente de já ter sido fechado ou não. Uma única query
 * (`LEFT JOIN` com review — incidentes nunca revisados continuam
 * aparecendo, com `reviewStatus: 'unreviewed'` sintetizado, mesmo idioma
 * de `enrichIncidentRows`/`getSupervisionOverview` desde a v3.5/v3.6).
 */
async function fetchDetectedRows(from: Date, to: Date, severity: OperationalSeverity | undefined): Promise<DetectedRow[]> {
  const conditions = [eq(auditLogs.action, INCIDENT_DETECTED_ACTION), gte(auditLogs.createdAt, from), lte(auditLogs.createdAt, to)];
  const severityCondition = severityConditionOrUndefined(severity);
  if (severityCondition) conditions.push(severityCondition);

  const rows = await db
    .select({
      id: auditLogs.id,
      detectedAt: auditLogs.createdAt,
      severity: sql<string>`${auditLogs.metadata}->>'severity'`,
      reviewStatus: sql<string>`coalesce(${agentOperationalIncidentReviews.status}, 'unreviewed')`,
    })
    .from(auditLogs)
    .leftJoin(agentOperationalIncidentReviews, eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogs.id))
    .where(and(...conditions));

  return rows.map((row) => ({
    id: row.id,
    detectedAt: row.detectedAt,
    severity: ((row.severity ?? 'info') as OperationalSeverity),
    reviewStatus: row.reviewStatus as DetectedRow['reviewStatus'],
  }));
}

/**
 * Coorte de SAÍDA (correio.md seção 3) — todo incidente cujo FECHAMENTO
 * real (`reviewed_at` quando `status` é `resolved`/`dismissed`) caiu no
 * período, independente de quando foi detectado. `INNER JOIN` com review
 * (só incidentes com uma linha de review terminal entram aqui — nenhum
 * incidente `unreviewed`/`acknowledged` pode satisfazer esta condição,
 * então o join nunca perde incidentes fechados).
 */
async function fetchClosedRows(from: Date, to: Date, severity: OperationalSeverity | undefined): Promise<ClosedRow[]> {
  const conditions = [
    eq(auditLogs.action, INCIDENT_DETECTED_ACTION),
    inArray(agentOperationalIncidentReviews.status, [...CLOSED_REVIEW_STATUSES]),
    gte(agentOperationalIncidentReviews.reviewedAt, from),
    lte(agentOperationalIncidentReviews.reviewedAt, to),
  ];
  const severityCondition = severityConditionOrUndefined(severity);
  if (severityCondition) conditions.push(severityCondition);

  const rows = await db
    .select({
      id: auditLogs.id,
      detectedAt: auditLogs.createdAt,
      severity: sql<string>`${auditLogs.metadata}->>'severity'`,
      closedAt: agentOperationalIncidentReviews.reviewedAt,
    })
    .from(auditLogs)
    .innerJoin(agentOperationalIncidentReviews, eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogs.id))
    .where(and(...conditions));

  return rows.map((row) => ({
    id: row.id,
    detectedAt: row.detectedAt,
    severity: ((row.severity ?? 'info') as OperationalSeverity),
    closedAt: row.closedAt,
  }));
}

/**
 * Agentes v4.2 (correio.md seção 13) — fotografia CORRENTE de todos os
 * incidentes ainda abertos (`reviewStatus` não terminal), deliberadamente
 * SEM filtro de período: "estes números representam o estado no momento
 * da consulta", nunca uma janela histórica — mesmo racional já aceito por
 * `getOperationalOwnershipWorkload` (v3.9), que também não recebe
 * `dateFrom`/`dateTo`. O filtro de `severity` (quando informado) continua
 * se aplicando — é uma dimensão ortogonal ao período.
 *
 * Reaproveita `computeIncidentSla` (v4.1) para o status de cada
 * incidente — NUNCA uma segunda política de "dentro/perto/fora do prazo"
 * (correio.md seção 2/23: "nenhuma automação/regra de SLA duplicada").
 */
async function getOpenSlaSnapshot(
  severity: OperationalSeverity | undefined,
  slaMinutesBySeverity: OperationalSlaMinutesBySeverity,
  now: Date,
): Promise<{ withinSla: number; warning: number; breached: number }> {
  const conditions = [eq(auditLogs.action, INCIDENT_DETECTED_ACTION), sql`coalesce(${agentOperationalIncidentReviews.status}, 'unreviewed') not in ('resolved', 'dismissed')`];
  const severityCondition = severityConditionOrUndefined(severity);
  if (severityCondition) conditions.push(severityCondition);

  const rows = await db
    .select({
      detectedAt: auditLogs.createdAt,
      severity: sql<string>`${auditLogs.metadata}->>'severity'`,
      reviewStatus: sql<string>`coalesce(${agentOperationalIncidentReviews.status}, 'unreviewed')`,
    })
    .from(auditLogs)
    .leftJoin(agentOperationalIncidentReviews, eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogs.id))
    .where(and(...conditions));

  const snapshot = { withinSla: 0, warning: 0, breached: 0 };
  for (const row of rows) {
    const rowSeverity = (row.severity ?? 'info') as OperationalSeverity;
    const status = computeIncidentSla({
      severity: rowSeverity,
      detectedAt: row.detectedAt,
      reviewStatus: row.reviewStatus as 'unreviewed' | 'acknowledged',
      closedAt: null,
      assignedAt: null,
      lastActivityAt: row.detectedAt,
      now,
      slaMinutesBySeverity,
    }).status;

    if (status === 'within_sla') snapshot.withinSla += 1;
    else if (status === 'warning') snapshot.warning += 1;
    else if (status === 'breached') snapshot.breached += 1;
    // 'completed' nunca acontece aqui (a query já exclui resolved/dismissed).
  }
  return snapshot;
}

/**
 * Agentes v4.2 (correio.md seção 10) — responsável NO MOMENTO DO
 * FECHAMENTO, reconstruído do audit trail de assign/reassign/unassign
 * (v3.8), NUNCA do assignment corrente (`agent_operational_incident_
 * assignments`, que pode ter sido alterado depois do incidente já
 * fechado — respondendo à pergunta obrigatória da seção 10: "o assignment
 * atual representa quem efetivamente tratou o incidente historicamente?"
 * — não necessariamente, então usa-se o histórico real em vez do estado
 * corrente).
 *
 * Uma única query para TODO o lote de incidentes fechados (nunca uma por
 * incidente) — o resultado é agrupado em memória e, para cada incidente,
 * caminha-se pelos eventos em ordem cronológica até o último ANTES/NO
 * `closedAt`; o `assigneeUserId` desse evento é a resposta (`null` se o
 * último evento antes do fechamento foi um `unassigned`, ou se não há
 * nenhum evento — incidente nunca teve responsável inequívoco no
 * fechamento, então é excluído do breakdown por responsável, correio.md
 * seção 10: "implementar apenas métricas cuja autoria seja inequívoca").
 */
async function resolveAssigneeAtClose(closedRows: ClosedRow[]): Promise<Map<number, number | null>> {
  const result = new Map<number, number | null>();
  if (closedRows.length === 0) return result;

  const ids = closedRows.map((row) => String(row.id));
  const events = await db
    .select({
      incidentAuditLogId: sql<string>`${auditLogs.metadata}->>'incidentAuditLogId'`,
      assigneeUserId: sql<string | null>`${auditLogs.metadata}->>'assigneeUserId'`,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(inArray(auditLogs.action, [...ASSIGNMENT_CHANGED_ACTIONS]), inArray(sql<string>`${auditLogs.metadata}->>'incidentAuditLogId'`, ids)))
    .orderBy(auditLogs.createdAt);

  const eventsByIncident = new Map<number, { assigneeUserId: number | null; createdAt: Date }[]>();
  for (const event of events) {
    const incidentAuditLogId = Number(event.incidentAuditLogId);
    const list = eventsByIncident.get(incidentAuditLogId) ?? [];
    list.push({ assigneeUserId: event.assigneeUserId === null ? null : Number(event.assigneeUserId), createdAt: event.createdAt });
    eventsByIncident.set(incidentAuditLogId, list);
  }

  for (const row of closedRows) {
    const events = eventsByIncident.get(row.id) ?? [];
    const lastBeforeClose = events.filter((event) => event.createdAt.getTime() <= row.closedAt.getTime()).at(-1);
    result.set(row.id, lastBeforeClose?.assigneeUserId ?? null);
  }
  return result;
}

/**
 * Ponto de entrada único (correio.md seção 14) — exatamente 6 queries,
 * sempre, independente do volume de incidentes no período (correio.md
 * seção 15: "o número de queries não deve crescer linearmente"):
 * detectados, fechados, snapshot de abertos, config de SLA, acknowledgements
 * em lote e (só quando há fechados) eventos de assignment em lote. Testado
 * explicitamente em `sla-analytics.integration.test.ts`.
 */
export async function getOperationalSlaAnalytics(params: GetOperationalSlaAnalyticsParams): Promise<OperationalSlaAnalytics> {
  const { from, to, severity } = params;
  const now = new Date();

  const [detectedRows, closedRows, slaMinutesBySeverity] = await Promise.all([
    fetchDetectedRows(from, to, severity),
    fetchClosedRows(from, to, severity),
    getOperationalSlaMinutesBySeverity(),
  ]);

  const [openSla, ackByIncidentId, assigneeAtCloseByIncidentId] = await Promise.all([
    getOpenSlaSnapshot(severity, slaMinutesBySeverity, now),
    getFirstAcknowledgedAtByAuditLogIds(detectedRows.map((row) => row.id)),
    resolveAssigneeAtClose(closedRows),
  ]);

  // --- Incidentes (seção 3) ---------------------------------------------
  const openCount = detectedRows.filter((row) => row.reviewStatus !== 'resolved' && row.reviewStatus !== 'dismissed').length;

  // --- SLA histórico (seção 5) — within/outside via computeIncidentSla, --
  // NUNCA uma segunda fórmula de deadline (mesma reutilização de
  // `getOpenSlaSnapshot` acima).
  const closedWithSla = closedRows.map((row) => {
    const slaResult = computeIncidentSla({
      severity: row.severity,
      detectedAt: row.detectedAt,
      reviewStatus: 'resolved',
      closedAt: row.closedAt,
      assignedAt: null,
      lastActivityAt: row.closedAt,
      now,
      slaMinutesBySeverity,
    });
    const resolutionSeconds = Math.max(0, Math.round((row.closedAt.getTime() - row.detectedAt.getTime()) / 1000));
    return { ...row, withinSla: slaResult.breachedAt === null, resolutionSeconds };
  });

  const completedWithinSla = closedWithSla.filter((row) => row.withinSla).length;
  const completedOutsideSla = closedWithSla.length - completedWithinSla;

  // --- Acknowledgement (seção 6) — escopado pela coorte de ENTRADA: mede
  // a velocidade de resposta a incidentes que chegaram no período, não a
  // incidentes fechados nele (distinção documentada no docblock do
  // arquivo, item 9 da descoberta).
  const ackSeconds: number[] = [];
  for (const row of detectedRows) {
    const acknowledgedAt = ackByIncidentId.get(row.id);
    if (acknowledgedAt) ackSeconds.push(Math.max(0, Math.round((acknowledgedAt.getTime() - row.detectedAt.getTime()) / 1000)));
  }

  const resolutionSecondsAll = closedWithSla.map((row) => row.resolutionSeconds);

  // --- Breakdown por severidade (seção 9) ---------------------------------
  const bySeverity = emptySeverityRecord<OperationalSlaSeverityBreakdown>(() => ({
    detected: 0,
    closed: 0,
    withinSla: 0,
    outsideSla: 0,
    breachRate: null,
    acknowledgement: { averageSeconds: null, medianSeconds: null },
    resolution: { averageSeconds: null, medianSeconds: null },
  }));

  for (const severityKey of OPERATIONAL_SEVERITIES) {
    const detectedForSeverity = detectedRows.filter((row) => row.severity === severityKey);
    const closedForSeverity = closedWithSla.filter((row) => row.severity === severityKey);
    const within = closedForSeverity.filter((row) => row.withinSla).length;
    const outside = closedForSeverity.length - within;

    const ackForSeverity: number[] = [];
    for (const row of detectedForSeverity) {
      const acknowledgedAt = ackByIncidentId.get(row.id);
      if (acknowledgedAt) ackForSeverity.push(Math.max(0, Math.round((acknowledgedAt.getTime() - row.detectedAt.getTime()) / 1000)));
    }

    bySeverity[severityKey] = {
      detected: detectedForSeverity.length,
      closed: closedForSeverity.length,
      withinSla: within,
      outsideSla: outside,
      breachRate: computeBreachRate(within, outside),
      acknowledgement: { averageSeconds: computeMean(ackForSeverity), medianSeconds: computeMedian(ackForSeverity) },
      resolution: {
        averageSeconds: computeMean(closedForSeverity.map((row) => row.resolutionSeconds)),
        medianSeconds: computeMedian(closedForSeverity.map((row) => row.resolutionSeconds)),
      },
    };
  }

  // --- Série temporal (seção 12) — granularidade diária fixa, zero-filled
  // para todo dia do período (nunca "inventa" um valor — dias sem eventos
  // são legitimamente 0, calculado em memória a partir das MESMAS linhas
  // já carregadas acima, nenhuma query extra).
  const trend: OperationalSlaTrendPoint[] = [];
  const trendByDate = new Map<string, OperationalSlaTrendPoint>();
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let pointCount = 0;
  while (cursor.getTime() <= end.getTime() && pointCount < MAX_TREND_POINTS) {
    const point: OperationalSlaTrendPoint = { date: dayKey(cursor), detected: 0, closed: 0, withinSla: 0, outsideSla: 0 };
    trend.push(point);
    trendByDate.set(point.date, point);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    pointCount += 1;
  }
  for (const row of detectedRows) {
    const point = trendByDate.get(dayKey(row.detectedAt));
    if (point) point.detected += 1;
  }
  for (const row of closedWithSla) {
    const point = trendByDate.get(dayKey(row.closedAt));
    if (!point) continue;
    point.closed += 1;
    if (row.withinSla) point.withinSla += 1;
    else point.outsideSla += 1;
  }

  // --- Por responsável (seção 10/11) ---------------------------------
  const assigneeAccByUserId = new Map<number, { closed: number; within: number; outside: number; resolutionSeconds: number[] }>();
  for (const row of closedWithSla) {
    const assigneeUserId = assigneeAtCloseByIncidentId.get(row.id) ?? null;
    if (assigneeUserId === null) continue; // autoria ambígua — excluído (seção 10).

    const acc = assigneeAccByUserId.get(assigneeUserId) ?? { closed: 0, within: 0, outside: 0, resolutionSeconds: [] };
    acc.closed += 1;
    if (row.withinSla) acc.within += 1;
    else acc.outside += 1;
    acc.resolutionSeconds.push(row.resolutionSeconds);
    assigneeAccByUserId.set(assigneeUserId, acc);
  }

  const byAssignee: OperationalSlaAssigneeAnalytics[] = Array.from(assigneeAccByUserId.entries())
    .map(([userId, acc]) => ({
      userId,
      displayName: null,
      closed: acc.closed,
      withinSla: acc.within,
      outsideSla: acc.outside,
      breachRate: computeBreachRate(acc.within, acc.outside),
      averageResolutionSeconds: computeMean(acc.resolutionSeconds),
      medianResolutionSeconds: computeMedian(acc.resolutionSeconds),
    }))
    // Nunca por desempenho (correio.md seção 11) — ordem determinística e
    // neutra por `userId`, mesmo princípio de `sortOperationalIncidentTimelineEvents`
    // (v4.0): nenhuma ordenação que implique "melhor"/"pior".
    .sort((a, b) => a.userId - b.userId);

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    incidents: { detected: detectedRows.length, closed: closedWithSla.length, open: openCount },
    sla: { completedWithinSla, completedOutsideSla, breachRate: computeBreachRate(completedWithinSla, completedOutsideSla) },
    acknowledgement: { count: ackSeconds.length, averageSeconds: computeMean(ackSeconds), medianSeconds: computeMedian(ackSeconds) },
    resolution: { count: resolutionSecondsAll.length, averageSeconds: computeMean(resolutionSecondsAll), medianSeconds: computeMedian(resolutionSecondsAll) },
    bySeverity,
    openSla,
    trend,
    byAssignee,
  };
}
