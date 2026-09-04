import { and, count, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentOperationalSupervisionRuns, auditLogs } from '../../db/schema/index.js';
import { OPERATIONAL_INCIDENT_TYPES, OPERATIONAL_RESPONSES, OPERATIONAL_SEVERITIES } from './health-types.js';
import type { OperationalIncidentType, OperationalResponse, OperationalSeverity } from './health-types.js';
import { SUPERVISION_RUN_STATUSES } from './supervision-run-history.js';
import type { SupervisionRunStatus } from './supervision-run-history.js';

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

  const [runRows, [findingsRow], severityRows, outcomeRows, [escalationsRow], recurringRows] = await Promise.all([
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
  outcome: 'observed' | 'recovered' | 'autonomy_restricted' | 'escalated' | 'failed' | 'skipped';
  hasEscalation: boolean;
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
}

const OUTCOME_AUDIT_ACTIONS = ['agents.operations.safe_recovery', 'agents.operations.autonomy_restricted', 'agents.operations.manual_attention', 'agents.operations.incident.failed'] as const;

function outcomeFromAction(action: (typeof OUTCOME_AUDIT_ACTIONS)[number] | undefined, response: OperationalResponse): SupervisionIncidentSummary['outcome'] {
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
 * exato) e a presença de escalation (por `metadata.incidentId` exato).
 * Sempre no máximo 3 queries extras, nunca uma por linha (evita N+1).
 */
async function enrichIncidentRows(
  rows: { id: number; entityType: string | null; entityId: string | null; metadata: unknown; createdAt: Date }[],
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

  const [candidateRuns, outcomeAudits, escalationRows] = await Promise.all([
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
  ]);

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
    };
  });
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

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ id: auditLogs.id, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      // busca uma janela maior que a página pedida quando há filtros
      // pós-enriquecimento (runStatus/hasEscalation), paginados em
      // memória depois — ver comentário abaixo.
      .limit(params.hasEscalation !== undefined || params.runStatus ? 500 : params.limit)
      .offset(params.hasEscalation !== undefined || params.runStatus ? 0 : (params.page - 1) * params.limit),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);

  let enriched = await enrichIncidentRows(rows);

  // `runStatus`/`hasEscalation` só existem depois do enriquecimento (não
  // são campos nativos do audit log) — filtrados aqui. Janela de 500
  // (acima) é uma concessão pragmática: suficiente para qualquer volume
  // operacional real deste sistema (não um SaaS multi-tenant de alto
  // volume), documentado como limitação conhecida em vez de introduzir
  // uma view materializada não pedida pelo correio.md.
  let total2 = Number(total);
  if (params.hasEscalation !== undefined) {
    enriched = enriched.filter((row) => row.hasEscalation === params.hasEscalation);
    total2 = enriched.length;
  }
  if (params.runStatus) {
    enriched = enriched.filter((row) => row.runStatus === params.runStatus);
    total2 = enriched.length;
  }
  if (params.hasEscalation !== undefined || params.runStatus) {
    enriched = enriched.slice((params.page - 1) * params.limit, params.page * params.limit);
  }

  return { rows: enriched, total: total2 };
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
}

export async function getSupervisionIncidentDetail(auditLogId: number): Promise<SupervisionIncidentDetail | null> {
  const [row] = await db
    .select({ id: auditLogs.id, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.id, auditLogId), eq(auditLogs.action, 'agents.operations.incident.detected')))
    .limit(1);

  if (!row) return null;

  const [summary] = await enrichIncidentRows([row]);
  if (!summary) return null;

  const incidentId = `${summary.incidentType}:${summary.entityType}:${summary.entityId}`;

  const [relatedAudits, [escalationRow]] = await Promise.all([
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
  ]);

  const outcomeAudit = relatedAudits.find((audit) => {
    const auditMetadata = audit.metadata as { incidentType?: string } | null;
    return (OUTCOME_AUDIT_ACTIONS as readonly string[]).includes(audit.action) && auditMetadata?.incidentType === summary.incidentType && audit.id !== row.id;
  });

  const outcomeMetadata = outcomeAudit?.metadata as { reason?: string; message?: string } | null;

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
