import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentAssignments, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { assignIncident, getIncidentAssignment, getIncidentAssignmentsByAuditLogIds, unassignIncident } from './incident-assignment-service.js';

/**
 * Agentes v3.8 (correio.md "Operational Incident Ownership & Assignment",
 * "21. Testes obrigatórios") — roda contra o Postgres de teste real.
 * Mesma técnica de `attention-queue-service.test.ts` (v3.7): audits
 * `agents.operations.incident.detected` inseridos diretamente (mesma
 * identidade canônica) — determinístico, sem depender de rodar o
 * Supervisor de verdade para testar o serviço de assignment em si.
 */
describe('Agentes v3.8 - incident-assignment-service (ownership humano)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const entityType = `assign_test_${suffix}`;

  let ceoUserId: number;
  let assigneeAId: number;
  let assigneeBId: number;
  const auditLogIds: number[] = [];
  const userIds: number[] = [];

  async function insertIncident(entityId: string) {
    const [row] = await db
      .insert(auditLogs)
      .values({
        actorType: 'system',
        action: 'agents.operations.incident.detected',
        entityType,
        entityId,
        metadata: { incidentType: 'operational_degradation', severity: 'warning', response: 'observe', dryRun: false, reason: 'fixture v3.8' },
      })
      .returning();
    auditLogIds.push(row!.id);
    return row!;
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    // Dois usuários reais dedicados ao teste (mesmo roleId do CEO —
    // elegibilidade de assignee neste sistema single-tenant é só "existe
    // em `users`", ver docblock de incident-assignment-service.ts; o
    // role em si é irrelevante para essa checagem).
    const [assigneeA] = await db.insert(users).values({ name: `Assignee A ${suffix}`, email: `assignee-a-${suffix}@example.com`, passwordHash: 'x', roleId: ceoUser.roleId, isActive: true }).returning();
    const [assigneeB] = await db.insert(users).values({ name: `Assignee B ${suffix}`, email: `assignee-b-${suffix}@example.com`, passwordHash: 'x', roleId: ceoUser.roleId, isActive: true }).returning();
    assigneeAId = assigneeA!.id;
    assigneeBId = assigneeB!.id;
    userIds.push(assigneeAId, assigneeBId);
  });

  after(async () => {
    await db.delete(agentOperationalIncidentAssignments).where(inArray(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogIds));
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditLogIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await database.end();
    redis.disconnect();
  });

  test('1/2/3/5/6/7/8: ciclo completo — sem responsável → assign → reassign → unassign, tudo auditado', async () => {
    const incident = await insertIncident(`e1-${suffix}`);

    // 1: incidente começa sem responsável.
    const initial = await getIncidentAssignment(incident.id);
    assert.ok(initial);
    assert.equal(initial!.assigneeUserId, null);

    // 2/3: assign funciona; aparece no "detalhe" (getIncidentAssignment).
    const assigned = await assignIncident(incident.id, assigneeAId, ceoUserId);
    assert.ok(assigned.ok);
    assert.equal(assigned.assignment.assigneeUserId, assigneeAId);
    assert.equal(assigned.assignment.assignedBy, ceoUserId);
    assert.ok(assigned.assignment.assignedAt);

    const afterAssign = await getIncidentAssignment(incident.id);
    assert.equal(afterAssign!.assigneeUserId, assigneeAId);

    // 5: reassign funciona.
    const reassigned = await assignIncident(incident.id, assigneeBId, ceoUserId);
    assert.ok(reassigned.ok);
    assert.equal(reassigned.assignment.assigneeUserId, assigneeBId);

    // 7: unassign funciona.
    const unassigned = await unassignIncident(incident.id, ceoUserId);
    assert.ok(unassigned.ok);
    assert.equal(unassigned.assignment.assigneeUserId, null);
    assert.equal((await getIncidentAssignment(incident.id))!.assigneeUserId, null);

    // Linha física removida do banco (mesma semântica de "unassigned =
    // ausência de linha" documentada no schema) — nunca uma linha com
    // assigneeUserId nulo persistida (a coluna nem aceita NULL).
    const rowsAfterUnassign = await db.select().from(agentOperationalIncidentAssignments).where(eq(agentOperationalIncidentAssignments.incidentAuditLogId, incident.id));
    assert.equal(rowsAfterUnassign.length, 0);

    // 6/8: histórico/audit registra responsável anterior e novo, e o
    // unassign também é auditado.
    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, String(incident.id))).orderBy(auditLogs.id);
    const relevant = auditRows.filter((row) => ['agents.operations.incident.assigned', 'agents.operations.incident.reassigned', 'agents.operations.incident.unassigned'].includes(row.action));
    assert.equal(relevant.length, 3, 'assign + reassign + unassign deveriam gerar exatamente 3 audits');

    const [assignedAudit, reassignedAudit, unassignedAudit] = relevant;
    assert.equal(assignedAudit!.action, 'agents.operations.incident.assigned');
    assert.deepEqual(assignedAudit!.metadata, { incidentAuditLogId: incident.id, previousAssigneeUserId: null, assigneeUserId: assigneeAId, performedByUserId: ceoUserId });

    assert.equal(reassignedAudit!.action, 'agents.operations.incident.reassigned');
    assert.deepEqual(reassignedAudit!.metadata, { incidentAuditLogId: incident.id, previousAssigneeUserId: assigneeAId, assigneeUserId: assigneeBId, performedByUserId: ceoUserId });

    assert.equal(unassignedAudit!.action, 'agents.operations.incident.unassigned');
    assert.deepEqual(unassignedAudit!.metadata, { incidentAuditLogId: incident.id, previousAssigneeUserId: assigneeBId, assigneeUserId: null, performedByUserId: ceoUserId });
  });

  test('5 (idempotência): atribuir o MESMO usuário novamente nunca falha e produz estado consistente', async () => {
    const incident = await insertIncident(`e2-${suffix}`);

    const first = await assignIncident(incident.id, assigneeAId, ceoUserId);
    assert.ok(first.ok);
    const second = await assignIncident(incident.id, assigneeAId, ceoUserId);
    assert.ok(second.ok, 'reatribuir ao mesmo usuário deveria ser idempotente (correio.md seção 5), nunca rejeitado');
    assert.equal(second.assignment.assigneeUserId, assigneeAId);

    const rows = await db.select().from(agentOperationalIncidentAssignments).where(eq(agentOperationalIncidentAssignments.incidentAuditLogId, incident.id));
    assert.equal(rows.length, 1, 'nunca deveria existir mais de uma linha para o mesmo incidente');
  });

  test('11/12: usuário inexistente é rejeitado (mesma checagem cobre "fora do contexto" — sistema single-tenant, sem uma segunda dimensão de elegibilidade)', async () => {
    const incident = await insertIncident(`e3-${suffix}`);

    const result = await assignIncident(incident.id, 999999999, ceoUserId);
    assert.deepEqual(result, { ok: false, code: 'invalid_assignee' });

    // Nenhuma linha deveria ter sido criada por uma tentativa rejeitada.
    assert.equal((await getIncidentAssignment(incident.id))!.assigneeUserId, null);
  });

  test('13: incidente inexistente é rejeitado (assign, unassign e getIncidentAssignment)', async () => {
    assert.equal(await getIncidentAssignment(999999999), null);
    assert.deepEqual(await assignIncident(999999999, assigneeAId, ceoUserId), { ok: false, code: 'invalid_incident' });
    assert.deepEqual(await unassignIncident(999999999, ceoUserId), { ok: false, code: 'invalid_incident' });

    // Audit real que NÃO é `incident.detected` (mesmo contraexemplo já
    // usado por incident-review-service.test.ts) também é rejeitado —
    // MESMA identidade canônica reaproveitada (isValidIncidentAuditLog),
    // nunca uma segunda checagem divergente.
    const [nonIncidentAudit] = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'agents.operations.scan.started')).orderBy(auditLogs.id).limit(1);
    assert.ok(nonIncidentAudit, 'setup: deveria existir ao menos um audit de scan.started na suíte');
    assert.equal(await getIncidentAssignment(nonIncidentAudit!.id), null);
    assert.deepEqual(await assignIncident(nonIncidentAudit!.id, assigneeAId, ceoUserId), { ok: false, code: 'invalid_incident' });
  });

  test('unassign de um incidente já sem responsável é idempotente e não gera audit novo', async () => {
    const incident = await insertIncident(`e4-${suffix}`);

    const before1 = await db.select().from(auditLogs).where(eq(auditLogs.entityId, String(incident.id)));
    const result = await unassignIncident(incident.id, ceoUserId);
    assert.ok(result.ok);
    assert.equal(result.assignment.assigneeUserId, null);

    const after1 = await db.select().from(auditLogs).where(eq(auditLogs.entityId, String(incident.id)));
    assert.equal(after1.length, before1.length, 'unassign sem nada a desatribuir não deveria gerar audit novo');
  });

  test('27: ausência de N+1 — getIncidentAssignmentsByAuditLogIds resolve um LOTE em uma única query', async () => {
    const incidents = await Promise.all(Array.from({ length: 6 }, (_, i) => insertIncident(`e5-${i}-${suffix}`)));
    await Promise.all(incidents.slice(0, 3).map((incident, i) => assignIncident(incident.id, i % 2 === 0 ? assigneeAId : assigneeBId, ceoUserId)));

    let selectCount = 0;
    const originalSelect = db.select.bind(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).select = (...args: unknown[]) => {
      selectCount += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalSelect as any)(...args);
    };
    let map: Map<number, { assigneeUserId: number | null }>;
    try {
      map = await getIncidentAssignmentsByAuditLogIds(incidents.map((i) => i.id));
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = originalSelect;
    }

    assert.equal(selectCount, 1, 'resolver 6 incidentes deveria custar exatamente 1 query, nunca uma por linha');
    assert.equal(map.size, 6);
    assert.equal(map.get(incidents[0]!.id)!.assigneeUserId, assigneeAId);
    assert.equal(map.get(incidents[3]!.id)!.assigneeUserId, null);

    // Array vazio → Map vazio, sem query (mesmo contrato de
    // getIncidentReviewsByAuditLogIds, v3.6).
    assert.equal((await getIncidentAssignmentsByAuditLogIds([])).size, 0);
  });

  test('28: concorrência — duas atribuições simultâneas ao MESMO incidente nunca corrompem/duplicam a linha', async () => {
    const incident = await insertIncident(`e6-${suffix}`);

    const [a, b] = await Promise.all([assignIncident(incident.id, assigneeAId, ceoUserId), assignIncident(incident.id, assigneeBId, ceoUserId)]);
    assert.ok(a.ok && b.ok);

    const finalState = await getIncidentAssignment(incident.id);
    assert.ok([assigneeAId, assigneeBId].includes(finalState!.assigneeUserId!), 'estado final deveria ser um dos dois valores escritos, nunca corrompido');

    const rows = await db.select().from(agentOperationalIncidentAssignments).where(eq(agentOperationalIncidentAssignments.incidentAuditLogId, incident.id));
    assert.equal(rows.length, 1, 'nunca deveria existir mais de uma linha para o mesmo incidente');
  });
});
