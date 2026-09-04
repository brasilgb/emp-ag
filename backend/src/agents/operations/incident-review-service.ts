import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentReviews, auditLogs } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';

/**
 * Agentes v3.6 (correio.md "Operational Incident Acknowledgement & Review
 * Workflow") — estado humano de revisão sobre um incidente já detectado
 * pelo Operational Supervisor. Ver docblock completo em
 * `db/schema/agent-operational-incident-reviews.ts` para a justificativa
 * da migration (nenhuma estrutura existente cobria "estado corrente por
 * incidente").
 *
 * Nunca altera Job/Run/Agent/autonomia/Recovery/Escalation (correio.md
 * seção 2) — este módulo só lê/escreve a própria tabela de review e
 * `audit_logs` (append-only, para o rastro da mudança).
 */

export const INCIDENT_REVIEW_STATUSES = ['acknowledged', 'resolved', 'dismissed'] as const;
export type IncidentReviewStatus = (typeof INCIDENT_REVIEW_STATUSES)[number];

export const INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED = ['unreviewed', ...INCIDENT_REVIEW_STATUSES] as const;
export type IncidentReviewStatusOrUnreviewed = (typeof INCIDENT_REVIEW_STATUSES_WITH_UNREVIEWED)[number];

export interface IncidentReview {
  auditLogId: number;
  status: IncidentReviewStatusOrUnreviewed;
  reviewedBy: number | null;
  reviewedAt: string | null;
  note: string | null;
  updatedAt: string | null;
}

const INCIDENT_DETECTED_ACTION = 'agents.operations.incident.detected';

/**
 * Identidade canônica do incidente (correio.md seção 3) — nunca
 * confirmado por "a linha existe", sempre por "é exatamente um
 * `agents.operations.incident.detected`". Reaproveitado tanto por leitura
 * quanto por escrita — mesma regra dos dois lados, nunca uma segunda
 * definição de "o que é um incidente válido".
 */
async function isValidIncidentAuditLog(auditLogId: number): Promise<boolean> {
  const [row] = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.id, auditLogId), eq(auditLogs.action, INCIDENT_DETECTED_ACTION))).limit(1);
  return row !== undefined;
}

function toIncidentReview(auditLogId: number, row: typeof agentOperationalIncidentReviews.$inferSelect | undefined): IncidentReview {
  if (!row) {
    // Nenhuma linha ainda — `unreviewed` é SINTETIZADO pela ausência
    // (ver docblock do schema), nunca lido de uma coluna.
    return { auditLogId, status: 'unreviewed', reviewedBy: null, reviewedAt: null, note: null, updatedAt: null };
  }

  return {
    auditLogId,
    status: row.status as IncidentReviewStatus,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt.toISOString(),
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `null` = o auditLogId não corresponde a um incidente válido (não existe,
 * ou existe mas não é `incident.detected`) — o caller (rota HTTP) traduz
 * isso para 404, mesmo padrão já usado por
 * `supervision-insights-service.ts:getSupervisionIncidentDetail` desde a
 * v3.5 (nunca dois comportamentos diferentes para "não é um incidente
 * válido" dependendo de qual endpoint pergunta).
 *
 * Uma única query além da validação de identidade (nunca N+1 — correio.md
 * seção 8/11 item 15) — usada tanto pela rota de detalhe do review quanto,
 * em lote, pelo enriquecimento de `listSupervisionIncidents` (v3.5,
 * seção 8 desta versão).
 */
export async function getIncidentReview(auditLogId: number): Promise<IncidentReview | null> {
  if (!(await isValidIncidentAuditLog(auditLogId))) return null;

  const [row] = await db.select().from(agentOperationalIncidentReviews).where(eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogId)).limit(1);
  return toIncidentReview(auditLogId, row);
}

export interface UpsertIncidentReviewInput {
  status: IncidentReviewStatus;
  note?: string | null;
}

export type UpsertIncidentReviewResult = { ok: true; review: IncidentReview } | { ok: false; code: 'invalid_incident' };

/**
 * Concorrência (correio.md seção 10) — `INSERT ... ON CONFLICT
 * (incident_audit_log_id) DO UPDATE` é uma única instrução atômica no
 * Postgres: duas requisições concorrentes para o MESMO incidente nunca
 * perdem uma atualização silenciosamente (a última a confirmar no banco
 * vence, de forma serializada pelo próprio lock de índice único do
 * Postgres — "uma solução simples e transacional", correio.md, sem
 * infraestrutura distribuída nova). Mesma garantia de atomicidade que
 * `createOrReopenEscalation` (v2.6) já usa via `onConflictDoNothing` —
 * aqui é `onConflictDoUpdate` porque, ao contrário de uma Escalation
 * (que tem "criar" vs. "reabrir" como decisões distintas), um review
 * humano é sempre "o estado mais recente que alguém definiu" — não há
 * uma segunda decisão de negócio a fazer na hora do conflito.
 */
export async function upsertIncidentReview(auditLogId: number, actorUserId: number, input: UpsertIncidentReviewInput): Promise<UpsertIncidentReviewResult> {
  if (!(await isValidIncidentAuditLog(auditLogId))) return { ok: false, code: 'invalid_incident' };

  // Estado anterior para o audit trail (seção 7: "estado anterior; estado
  // novo") — lido ANTES do upsert, na mesma leitura que já fazíamos para
  // devolver o valor "atual" em GET; nenhuma query extra dedicada só para
  // isto.
  const [previousRow] = await db.select({ status: agentOperationalIncidentReviews.status }).from(agentOperationalIncidentReviews).where(eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogId)).limit(1);
  const previousStatus: IncidentReviewStatusOrUnreviewed = (previousRow?.status as IncidentReviewStatus | undefined) ?? 'unreviewed';

  const now = new Date();
  const note = input.note ?? null;

  const [row] = await db
    .insert(agentOperationalIncidentReviews)
    .values({
      incidentAuditLogId: auditLogId,
      status: input.status,
      reviewedBy: actorUserId,
      reviewedAt: now,
      note,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: agentOperationalIncidentReviews.incidentAuditLogId,
      set: { status: input.status, reviewedBy: actorUserId, reviewedAt: now, note, updatedAt: now },
    })
    .returning();

  // Auditoria append-only (correio.md seção 7): incidente, estado
  // anterior, estado novo, usuário, timestamp, PRESENÇA de nota — nunca o
  // conteúdo da nota em si. `audit_logs` já guarda texto humano livre em
  // outros domínios do projeto (ex.: `financial_entries`/`support_tickets`
  // via seus próprios módulos), mas nunca dentro de `metadata` de um
  // audit de Agentes — mantido assim aqui também: nota é texto arbitrário
  // digitado por um humano, tratado com o mesmo cuidado de "nunca gravar
  // conteúdo sensível" já seguido pelo resto de `agents/operations/*`
  // (nunca `.stack`, nunca payload bruto). Fica só no campo `note` da
  // própria tabela de review, nunca duplicado no audit trail.
  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.operations.incident_review.changed',
    entityType: 'agent_operational_incident_review',
    entityId: String(auditLogId),
    metadata: { incidentAuditLogId: auditLogId, previousStatus, newStatus: input.status, hasNote: note !== null && note.length > 0 },
  });

  return { ok: true, review: toIncidentReview(auditLogId, row) };
}

/**
 * Busca em lote (correio.md seção 8: "sem criar N+1") — usada por
 * `supervision-insights-service.ts` para enriquecer uma PÁGINA inteira de
 * incidentes com uma única query extra, nunca uma por linha.
 */
export async function getIncidentReviewsByAuditLogIds(auditLogIds: number[]): Promise<Map<number, IncidentReview>> {
  if (auditLogIds.length === 0) return new Map();

  const rows = await db.select().from(agentOperationalIncidentReviews).where(inArray(agentOperationalIncidentReviews.incidentAuditLogId, auditLogIds));

  const map = new Map<number, IncidentReview>();
  for (const auditLogId of auditLogIds) {
    const row = rows.find((r) => r.incidentAuditLogId === auditLogId);
    map.set(auditLogId, toIncidentReview(auditLogId, row));
  }
  return map;
}
