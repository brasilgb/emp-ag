import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentAssignments, users } from '../../db/schema/index.js';
import { audit } from '../../services/audit.js';
import { isValidIncidentAuditLog } from './incident-review-service.js';

/**
 * Agentes v3.8 (correio.md "Operational Incident Ownership & Assignment")
 * — ownership humano de um incidente já detectado pelo Operational
 * Supervisor. Ver docblock completo em
 * `db/schema/agent-operational-incident-assignments.ts` para a
 * justificativa da migration (nenhuma estrutura existente cobria
 * "responsável corrente por incidente" sem misturar review/escalation).
 *
 * Puramente uma ferramenta de COORDENAÇÃO HUMANA (correio.md "Objetivo"):
 * nunca altera Job/Run/Agent/autonomia/Recovery/Escalation/reviewStatus —
 * este módulo só lê/escreve a própria tabela de assignment e
 * `audit_logs` (append-only, para o rastro da mudança). Nenhuma ação
 * automática (assign nunca dispara acknowledge/resolve/dismiss, e
 * vice-versa — testado explicitamente).
 */

export interface IncidentAssignment {
  auditLogId: number;
  // `null` = não atribuído (SINTETIZADO pela ausência de linha — mesmo
  // idioma de `unreviewed` em incident-review-service.ts).
  assigneeUserId: number | null;
  assignedBy: number | null;
  assignedAt: string | null;
  updatedAt: string | null;
}

function toIncidentAssignment(auditLogId: number, row: typeof agentOperationalIncidentAssignments.$inferSelect | undefined): IncidentAssignment {
  if (!row) {
    return { auditLogId, assigneeUserId: null, assignedBy: null, assignedAt: null, updatedAt: null };
  }

  return {
    auditLogId,
    assigneeUserId: row.assigneeUserId,
    assignedBy: row.assignedBy,
    assignedAt: row.assignedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `null` = o auditLogId não corresponde a um incidente válido — mesmo
 * contrato de `getIncidentReview` (o caller HTTP traduz para 404).
 */
export async function getIncidentAssignment(auditLogId: number): Promise<IncidentAssignment | null> {
  if (!(await isValidIncidentAuditLog(auditLogId))) return null;

  const [row] = await db.select().from(agentOperationalIncidentAssignments).where(eq(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogId)).limit(1);
  return toIncidentAssignment(auditLogId, row);
}

/**
 * Busca em lote (correio.md seção 19: "não pode transformar
 * listAttentionQueue em consulta por linha") — usada por
 * `supervision-insights-service.ts` para enriquecer uma PÁGINA inteira
 * de incidentes com uma única query extra, mesmo padrão de
 * `getIncidentReviewsByAuditLogIds` (v3.6).
 */
export async function getIncidentAssignmentsByAuditLogIds(auditLogIds: number[]): Promise<Map<number, IncidentAssignment>> {
  if (auditLogIds.length === 0) return new Map();

  const rows = await db.select().from(agentOperationalIncidentAssignments).where(inArray(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogIds));

  const map = new Map<number, IncidentAssignment>();
  for (const auditLogId of auditLogIds) {
    const row = rows.find((r) => r.incidentAuditLogId === auditLogId);
    map.set(auditLogId, toIncidentAssignment(auditLogId, row));
  }
  return map;
}

/**
 * Elegibilidade do assignee (correio.md seção 7/20): revisado em código
 * ANTES de implementar (seção 1) — este projeto é confirmadamente
 * single-tenant (nenhuma tabela `tenants`/`workspaces`/`organizations`/
 * `memberships` existe em `db/schema/*`), e nenhum precedente real do
 * projeto (`reassignFollowUp`, criação de Goal/Initiative/Responsibility)
 * escopa "usuário elegível" por papel/contexto — todos usam exatamente a
 * mesma checagem: "a linha existe em `users`". Reaproveitada aqui, sem
 * inventar uma segunda noção de elegibilidade. Documentado como
 * limitação conhecida: não há uma segunda dimensão de "contexto" para
 * testar neste sistema além de "o id existe" (ver
 * incident-assignment-service.test.ts).
 */
async function isEligibleAssignee(userId: number): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return row !== undefined;
}

export type AssignIncidentResult = { ok: true; assignment: IncidentAssignment } | { ok: false; code: 'invalid_incident' | 'invalid_assignee' };
export type UnassignIncidentResult = { ok: true; assignment: IncidentAssignment } | { ok: false; code: 'invalid_incident' };

/**
 * Assign/reassign (correio.md seção 5) — uma única operação para os dois
 * casos ("Reassignment pode ser consequência natural de `assignIncident`",
 * seção 9), nunca dois endpoints/serviços redundantes.
 *
 * Concorrência (seção 10) — `INSERT ... ON CONFLICT (incident_audit_log_id)
 * DO UPDATE`, mesma instrução atômica já usada por
 * `upsertIncidentReview` (v3.6): duas atribuições concorrentes para o
 * MESMO incidente nunca corrompem/duplicam a linha — o índice único é o
 * ponto de serialização nativo do Postgres. Nenhum lock global do
 * Supervisor (seção 10: "o assignment deve ser isolado por incidente").
 *
 * Idempotência (seção 5: "preferência: idempotência") — atribuir
 * novamente o MESMO usuário nunca falha e sempre devolve o estado final
 * correto; o audit trail registra a chamada mesmo assim (previousAssigneeUserId
 * === assigneeUserId quando idempotente) — mesma escolha já feita por
 * `upsertIncidentReview` (v3.6), que também audita toda chamada
 * independente de o status mudar ou não: o audit registra "uma ação
 * humana aconteceu", não "o estado mudou".
 */
export async function assignIncident(auditLogId: number, assigneeUserId: number, actorUserId: number): Promise<AssignIncidentResult> {
  if (!(await isValidIncidentAuditLog(auditLogId))) return { ok: false, code: 'invalid_incident' };
  if (!(await isEligibleAssignee(assigneeUserId))) return { ok: false, code: 'invalid_assignee' };

  const [previousRow] = await db.select({ assigneeUserId: agentOperationalIncidentAssignments.assigneeUserId }).from(agentOperationalIncidentAssignments).where(eq(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogId)).limit(1);
  const previousAssigneeUserId: number | null = previousRow?.assigneeUserId ?? null;

  const now = new Date();

  const [row] = await db
    .insert(agentOperationalIncidentAssignments)
    .values({ incidentAuditLogId: auditLogId, assigneeUserId, assignedBy: actorUserId, assignedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: agentOperationalIncidentAssignments.incidentAuditLogId,
      set: { assigneeUserId, assignedBy: actorUserId, assignedAt: now, updatedAt: now },
    })
    .returning();

  // Auditoria append-only (correio.md seção 4): `assigned` quando o
  // incidente não tinha responsável (previousAssigneeUserId === null),
  // `reassigned` caso contrário (inclusive reatribuição idempotente ao
  // MESMO usuário — o campo `previousAssigneeUserId === assigneeUserId`
  // no próprio metadata já deixa isso auditável/explicável).
  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: previousAssigneeUserId === null ? 'agents.operations.incident.assigned' : 'agents.operations.incident.reassigned',
    entityType: 'agent_operational_incident_assignment',
    entityId: String(auditLogId),
    metadata: { incidentAuditLogId: auditLogId, previousAssigneeUserId, assigneeUserId, performedByUserId: actorUserId },
  });

  return { ok: true, assignment: toIncidentAssignment(auditLogId, row) };
}

/**
 * Unassign (correio.md seção 5) — `assigned → unassigned`. DELETE da
 * linha (mesma semântica de "unassigned = ausência de linha" do schema).
 * Idempotente por natureza (DELETE de 0 linhas nunca é erro) — chamar
 * unassign num incidente já sem responsável devolve sucesso com o
 * estado (já) desatribuído, sem gerar auditoria nova (nada mudou de
 * fato — mesma lógica de "só auditar mudança real" documentada acima
 * para o caso oposto).
 *
 * Correio.md seção 6: nunca altera `reviewStatus` — nenhuma chamada a
 * `incident-review-service.ts` acontece aqui. Um incidente `resolved`/
 * `dismissed` mantém o assignment persistido para contexto histórico
 * (a fila `Needs Attention` já o remove pelo `reviewStatus`, nunca por
 * causa do assignment).
 */
export async function unassignIncident(auditLogId: number, actorUserId: number): Promise<UnassignIncidentResult> {
  if (!(await isValidIncidentAuditLog(auditLogId))) return { ok: false, code: 'invalid_incident' };

  const [previousRow] = await db.select({ assigneeUserId: agentOperationalIncidentAssignments.assigneeUserId }).from(agentOperationalIncidentAssignments).where(eq(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogId)).limit(1);

  if (!previousRow) {
    // Já desatribuído — nada a fazer, nada a auditar.
    return { ok: true, assignment: toIncidentAssignment(auditLogId, undefined) };
  }

  await db.delete(agentOperationalIncidentAssignments).where(and(eq(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogId)));

  await audit({
    userId: actorUserId,
    actorType: 'user',
    actorId: String(actorUserId),
    action: 'agents.operations.incident.unassigned',
    entityType: 'agent_operational_incident_assignment',
    entityId: String(auditLogId),
    metadata: { incidentAuditLogId: auditLogId, previousAssigneeUserId: previousRow.assigneeUserId, assigneeUserId: null, performedByUserId: actorUserId },
  });

  return { ok: true, assignment: toIncidentAssignment(auditLogId, undefined) };
}
