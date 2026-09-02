import { and, count, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentAutonomyBlocks, agentEventDeliveries, agentJobRuns } from '../../db/schema/index.js';
import { resolveGlobalSetting } from '../settings/resolver.js';

import { INCIDENT_TYPES, type IncidentType } from './schemas.js';

export interface Incident {
  // Id sintético (nunca persistido) — `${source}:${sourceId}` garante
  // unicidade entre as 3 fontes sem precisar de uma tabela nova (seção 6:
  // "persistência adicional só se houver justificativa arquitetural").
  id: string;
  type: IncidentType;
  occurredAt: string;
  jobId: number | null;
  ruleId: number | null;
  eventId: number | null;
  rootExecutionId: number | null;
  summary: string;
  details: Record<string, unknown>;
}

const AUTONOMY_BLOCK_INCIDENT_REASONS = [
  'autonomy_circuit_open',
  'autonomous_cycle_detected',
  'autonomy_depth_exceeded',
  'autonomy_chain_budget_exceeded',
  'autonomous_rate_limit_exceeded',
] as const satisfies readonly IncidentType[];

interface SourceFilters {
  jobId?: number;
  from?: Date;
  to?: Date;
}

async function fetchAutonomyBlockIncidents(
  filters: SourceFilters,
  reasonFilter: IncidentType | undefined,
  limit: number,
  offset: number,
): Promise<{ rows: Incident[]; total: number }> {
  const reasons = reasonFilter
    ? AUTONOMY_BLOCK_INCIDENT_REASONS.includes(reasonFilter as (typeof AUTONOMY_BLOCK_INCIDENT_REASONS)[number])
      ? [reasonFilter]
      : []
    : AUTONOMY_BLOCK_INCIDENT_REASONS;

  if (reasons.length === 0) {
    return { rows: [], total: 0 };
  }

  const conditions: SQL[] = [inArray(agentAutonomyBlocks.reason, reasons)];
  if (filters.jobId) conditions.push(eq(agentAutonomyBlocks.jobId, filters.jobId));
  if (filters.from) conditions.push(gte(agentAutonomyBlocks.createdAt, filters.from));
  if (filters.to) conditions.push(lte(agentAutonomyBlocks.createdAt, filters.to));
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentAutonomyBlocks)
      .where(where)
      .orderBy(desc(agentAutonomyBlocks.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(agentAutonomyBlocks).where(where),
  ]);

  return {
    total: Number(total),
    rows: rows.map((row) => ({
      id: `autonomy_block:${row.id}`,
      type: row.reason as IncidentType,
      occurredAt: row.createdAt.toISOString(),
      jobId: row.jobId,
      ruleId: row.ruleId,
      eventId: row.eventId,
      rootExecutionId: row.rootExecutionId,
      summary: `Execução autônoma bloqueada (${row.reason})`,
      details: {
        triggerType: row.triggerType,
        causationRunId: row.causationRunId,
        attemptedDepth: row.attemptedDepth,
        limit: row.limitValue,
        current: row.currentValue,
      },
    })),
  };
}

async function fetchEventDeliveryFailedIncidents(
  filters: SourceFilters,
  limit: number,
  offset: number,
): Promise<{ rows: Incident[]; total: number }> {
  const conditions: SQL[] = [eq(agentEventDeliveries.status, 'failed')];
  if (filters.jobId) conditions.push(eq(agentEventDeliveries.jobId, filters.jobId));
  if (filters.from) conditions.push(gte(agentEventDeliveries.createdAt, filters.from));
  if (filters.to) conditions.push(lte(agentEventDeliveries.createdAt, filters.to));
  const where = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(agentEventDeliveries)
      .where(where)
      .orderBy(desc(agentEventDeliveries.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(agentEventDeliveries).where(where),
  ]);

  return {
    total: Number(total),
    rows: rows.map((row) => ({
      id: `event_delivery:${row.id}`,
      type: 'event_delivery_failed' as const,
      occurredAt: row.createdAt.toISOString(),
      jobId: row.jobId,
      ruleId: row.ruleId,
      eventId: row.eventId,
      rootExecutionId: null,
      summary: `Delivery de evento falhou (${row.errorCode ?? 'sem código'})`,
      details: { errorCode: row.errorCode, errorMessage: row.errorMessage, jobRunId: row.jobRunId },
    })),
  };
}

// job_repeated_failure (seção 6): projeção sobre agent_job_runs — os 3
// Runs mais recentes de um Job são todos 'failed'. Sinal mais cedo que o
// circuit breaker (que exige AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD
// consecutivas e só conta falhas não-manuais) — aqui contam Runs de
// qualquer trigger, é observabilidade, não gate de execução. Window
// function (ROW_NUMBER) em vez de N queries por Job.
async function fetchRepeatedFailureIncidents(
  filters: SourceFilters,
  limit: number,
  offset: number,
): Promise<{ rows: Incident[]; total: number }> {
  const jobFilter = filters.jobId ? sql`and ${agentJobRuns.jobId} = ${filters.jobId}` : sql``;
  const fromFilter = filters.from ? sql`and ${agentJobRuns.createdAt} >= ${filters.from}` : sql``;
  const toFilter = filters.to ? sql`and ${agentJobRuns.createdAt} <= ${filters.to}` : sql``;

  // Agentes v1.7 — a janela usada para "falhas repetidas" agora é o
  // circuit.failureThreshold efetivo (resolver central), eliminando a
  // divergência com o circuit breaker real apontada no relatório da v1.6
  // (a janela era um "3" fixo, sem relação com
  // AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD). Limitação documentada: só
  // o valor GLOBAL é usado aqui — um Job com override próprio de
  // circuit.failureThreshold não muda a janela desta query específica
  // (uma janela por-Job variável exigiria uma window function com N
  // dinâmico por partição, sem suporte direto em SQL padrão sem lateral
  // join por Job; não implementado nesta versão por risco/complexidade
  // desproporcional a uma tela de observabilidade — ver riscos na
  // entrega).
  const globalThreshold = await resolveGlobalSetting('circuit.failureThreshold');
  const window = globalThreshold.effectiveValue;

  const ranked = db.$with('ranked_runs').as(
    db
      .select({
        id: agentJobRuns.id,
        jobId: agentJobRuns.jobId,
        status: agentJobRuns.status,
        createdAt: agentJobRuns.createdAt,
        rn: sql<number>`row_number() over (partition by ${agentJobRuns.jobId} order by ${agentJobRuns.createdAt} desc)`.as(
          'rn',
        ),
      })
      .from(agentJobRuns)
      .where(sql`true ${jobFilter} ${fromFilter} ${toFilter}`),
  );

  const failingJobsQuery = db
    .with(ranked)
    .select({
      jobId: ranked.jobId,
      lastFailedAt: sql<Date>`max(${ranked.createdAt})`,
      failedRunIds: sql<number[]>`array_agg(${ranked.id} order by ${ranked.createdAt} desc)`,
    })
    .from(ranked)
    .where(sql`${ranked.rn} <= ${window}`)
    .groupBy(ranked.jobId)
    .having(sql`count(*) filter (where ${ranked.status} = 'failed') = ${window}`);

  const failingJobs = await failingJobsQuery;
  const total = failingJobs.length;
  const page = failingJobs
    .sort((a, b) => new Date(b.lastFailedAt).getTime() - new Date(a.lastFailedAt).getTime())
    .slice(offset, offset + limit);

  return {
    total,
    rows: page.map((row) => ({
      id: `job_repeated_failure:${row.jobId}`,
      type: 'job_repeated_failure' as const,
      occurredAt: new Date(row.lastFailedAt).toISOString(),
      jobId: row.jobId,
      ruleId: null,
      eventId: null,
      rootExecutionId: null,
      summary: `Job com as últimas ${window} execuções falhando (mesmo threshold do circuit breaker global)`,
      details: { lastFailedRunIds: row.failedRunIds, threshold: window },
    })),
  };
}

/**
 * Agentes v1.6 (correio.md seção 6) — ponto central de derivação de
 * incidentes. Quando `type` é informado, delega a paginação real
 * (page/limit corretos) para a única fonte relevante. Sem `type`, busca
 * até `limit` de cada uma das 3 fontes, mescla e ordena por `occurredAt`
 * em memória — decisão documentada: pagina de forma exata por fonte
 * porque as fontes têm naturezas incomparáveis (bloqueio pontual vs.
 * projeção agregada por Job); "página 2 sem filtro de tipo" é uma
 * aproximação best-effort aceitável para uma tela operacional, nunca uma
 * fonte de verdade transacional.
 */
export async function listIncidents(params: {
  page: number;
  limit: number;
  type?: IncidentType;
  jobId?: number;
  from?: Date;
  to?: Date;
}): Promise<{ data: Incident[]; total: number }> {
  const { page, limit, type, jobId, from, to } = params;
  const filters: SourceFilters = { jobId, from, to };
  const offset = (page - 1) * limit;

  if (type) {
    const result =
      type === 'event_delivery_failed'
        ? await fetchEventDeliveryFailedIncidents(filters, limit, offset)
        : type === 'job_repeated_failure'
          ? await fetchRepeatedFailureIncidents(filters, limit, offset)
          : await fetchAutonomyBlockIncidents(filters, type, limit, offset);

    return { data: result.rows, total: result.total };
  }

  const [blocks, deliveries, repeated] = await Promise.all([
    fetchAutonomyBlockIncidents(filters, undefined, limit, 0),
    fetchEventDeliveryFailedIncidents(filters, limit, 0),
    fetchRepeatedFailureIncidents(filters, limit, 0),
  ]);

  const merged = [...blocks.rows, ...deliveries.rows, ...repeated.rows]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(offset, offset + limit);

  return {
    data: merged,
    total: blocks.total + deliveries.total + repeated.total,
  };
}

export { INCIDENT_TYPES };
