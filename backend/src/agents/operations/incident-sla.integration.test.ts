import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentAssignments, agentOperationalIncidentReviews, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { assignIncident, unassignIncident } from './incident-assignment-service.js';
import { upsertIncidentReview } from './incident-review-service.js';
import { getSupervisionIncidentDetail, listAttentionQueue, listSupervisionIncidents } from './supervision-insights-service.js';

/**
 * Agentes v4.1 (correio.md "Operational Incident Aging & SLA
 * Visibility", "16. Testes obrigatórios" itens 6/8/9/10/13/18/20) — roda
 * contra o Postgres de teste real, com incidentes sintéticos inseridos
 * diretamente (mesma técnica de attention-queue-service.test.ts/
 * incident-timeline.test.ts). Cobre o que `computeIncidentSla`
 * (função pura, incident-sla.test.ts) não alcança: a integração real com
 * `enrichIncidentRows`/`getSupervisionIncidentDetail` — leitura em lote
 * do `sla`, timestamps EXATOS derivados do histórico real de
 * review/assignment, e ausência de N+1.
 */
describe('Agentes v4.1 - incident-sla (integração com enrichIncidentRows/getSupervisionIncidentDetail)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const entityType = `sla_test_${suffix}`;

  let ceoUserId: number;
  let assigneeAId: number;
  const auditLogIds: number[] = [];
  const userIds: number[] = [];

  async function insertIncident(entityId: string, severity: 'info' | 'warning' | 'critical' = 'critical') {
    const [row] = await db
      .insert(auditLogs)
      .values({
        actorType: 'system',
        action: 'agents.operations.incident.detected',
        entityType,
        entityId,
        metadata: { incidentType: 'operational_degradation', severity, response: 'observe', dryRun: false, reason: 'fixture v4.1' },
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

    const [assigneeA] = await db.insert(users).values({ name: `SLA Assignee A ${suffix}`, email: `sla-assignee-a-${suffix}@example.com`, passwordHash: 'x', roleId: ceoUser.roleId, isActive: true }).returning();
    assigneeAId = assigneeA!.id;
    userIds.push(assigneeAId);
  });

  after(async () => {
    await db.delete(agentOperationalIncidentAssignments).where(inArray(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogIds));
    await db.delete(agentOperationalIncidentReviews).where(inArray(agentOperationalIncidentReviews.incidentAuditLogId, auditLogIds));
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditLogIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await database.end();
    redis.disconnect();
  });

  test('6: acknowledgedAt exato no detalhe reflete a transição REAL unreviewed→acknowledged', async () => {
    const incident = await insertIncident(`e6-${suffix}`);
    const before1 = new Date();
    await upsertIncidentReview(incident.id, ceoUserId, { status: 'acknowledged' });

    const detail = await getSupervisionIncidentDetail(incident.id);
    assert.ok(detail);
    assert.ok(detail!.sla.acknowledgedAt);
    assert.ok(new Date(detail!.sla.acknowledgedAt!).getTime() >= before1.getTime());
    assert.ok(detail!.sla.acknowledgementSeconds !== null && detail!.sla.acknowledgementSeconds! >= 0);

    // Uma segunda transição (acknowledged → resolved) NÃO deveria mudar
    // `acknowledgedAt` — continua sendo a PRIMEIRA transição para
    // acknowledged, nunca a mais recente.
    const firstAckAt = detail!.sla.acknowledgedAt;
    await upsertIncidentReview(incident.id, ceoUserId, { status: 'resolved' });
    const detailAfterResolve = await getSupervisionIncidentDetail(incident.id);
    assert.equal(detailAfterResolve!.sla.acknowledgedAt, firstAckAt, 'acknowledgedAt deveria continuar apontando para a PRIMEIRA transição, mesmo após o incidente ser resolvido');
    assert.equal(detailAfterResolve!.sla.status, 'completed');
  });

  test('7/8/9: assignedAt/assignmentAgeSeconds refletem o assignment corrente; reassign atualiza; unassign remove', async () => {
    const incident = await insertIncident(`e7-${suffix}`);

    const noneAssigned = await getSupervisionIncidentDetail(incident.id);
    assert.equal(noneAssigned!.sla.assignedAt, null);
    assert.equal(noneAssigned!.sla.assignmentAgeSeconds, null);

    await assignIncident(incident.id, assigneeAId, ceoUserId);
    const afterAssign = await getSupervisionIncidentDetail(incident.id);
    assert.ok(afterAssign!.sla.assignedAt);
    assert.ok(afterAssign!.sla.assignmentAgeSeconds !== null && afterAssign!.sla.assignmentAgeSeconds! >= 0);

    // 8: reassign para o MESMO usuário (idempotente, v3.8) ainda assim
    // atualiza `assignedAt` — reflete a atribuição CORRENTE, nunca a
    // primeira.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await assignIncident(incident.id, assigneeAId, ceoUserId);
    const afterReassign = await getSupervisionIncidentDetail(incident.id);
    assert.ok(new Date(afterReassign!.sla.assignedAt!).getTime() >= new Date(afterAssign!.sla.assignedAt!).getTime());

    // 9: unassign remove o contexto de assignment corrente.
    await unassignIncident(incident.id, ceoUserId);
    const afterUnassign = await getSupervisionIncidentDetail(incident.id);
    assert.equal(afterUnassign!.sla.assignedAt, null);
    assert.equal(afterUnassign!.sla.assignmentAgeSeconds, null);
  });

  test('10: lastActivityAt usa o evento correto — muda a cada ação relevante, sempre o mais recente', async () => {
    const incident = await insertIncident(`e10-${suffix}`);
    const detected = await getSupervisionIncidentDetail(incident.id);
    const detectedActivity = detected!.sla.lastActivityAt;

    await upsertIncidentReview(incident.id, ceoUserId, { status: 'acknowledged' });
    const afterAck = await getSupervisionIncidentDetail(incident.id);
    assert.ok(new Date(afterAck!.sla.lastActivityAt).getTime() > new Date(detectedActivity).getTime(), 'acknowledge deveria contar como atividade mais recente que a detecção');

    await assignIncident(incident.id, assigneeAId, ceoUserId);
    const afterAssign = await getSupervisionIncidentDetail(incident.id);
    assert.ok(new Date(afterAssign!.sla.lastActivityAt).getTime() >= new Date(afterAck!.sla.lastActivityAt).getTime(), 'assign deveria contar como atividade mais recente que o acknowledge anterior');
  });

  test('13: sla de um incidente nunca é afetado por eventos de outro incidente', async () => {
    const incidentA = await insertIncident(`e13-a-${suffix}`);
    const incidentB = await insertIncident(`e13-b-${suffix}`);

    await assignIncident(incidentA.id, assigneeAId, ceoUserId);
    await upsertIncidentReview(incidentB.id, ceoUserId, { status: 'acknowledged' });

    const detailA = await getSupervisionIncidentDetail(incidentA.id);
    const detailB = await getSupervisionIncidentDetail(incidentB.id);

    assert.ok(detailA!.sla.assignedAt, 'A foi atribuído');
    assert.equal(detailB!.sla.assignedAt, null, 'B nunca foi atribuído — não deveria herdar o assignment de A');
    assert.equal(detailA!.sla.acknowledgedAt, null, 'A nunca foi reconhecido — não deveria herdar o acknowledge de B');
    assert.ok(detailB!.sla.acknowledgedAt, 'B foi reconhecido');
  });

  test('18: ausência de N+1 — listAttentionQueue/listSupervisionIncidents custam o mesmo número de queries independente do volume', async () => {
    const small = await insertIncident(`e18-small-${suffix}`);
    await assignIncident(small.id, assigneeAId, ceoUserId);

    const largeIncidents = await Promise.all(Array.from({ length: 6 }, (_, i) => insertIncident(`e18-large-${i}-${suffix}`)));
    await Promise.all(largeIncidents.map((incident) => upsertIncidentReview(incident.id, ceoUserId, { status: 'acknowledged' })));

    async function countSelects(fn: () => Promise<unknown>): Promise<number> {
      let selectCount = 0;
      const originalSelect = db.select.bind(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = (...args: unknown[]) => {
        selectCount += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalSelect as any)(...args);
      };
      try {
        await fn();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).select = originalSelect;
      }
      return selectCount;
    }

    const smallCount = await countSelects(() => listAttentionQueue({ entityType, page: 1, limit: 50, entityId: `e18-small-${suffix}` }));
    const largeCount = await countSelects(() => listAttentionQueue({ entityType, page: 1, limit: 50 }));
    assert.equal(smallCount, largeCount, `listAttentionQueue: número de queries deveria ser constante (1 incidente: ${smallCount}; 7 incidentes: ${largeCount})`);

    const historySmall = await countSelects(() => listSupervisionIncidents({ page: 1, limit: 50, entityType, entityId: `e18-small-${suffix}` }));
    const historyLarge = await countSelects(() => listSupervisionIncidents({ page: 1, limit: 50, entityType }));
    assert.equal(historySmall, historyLarge, `listSupervisionIncidents: número de queries deveria ser constante (1 incidente: ${historySmall}; 7 incidentes: ${historyLarge})`);
  });

  test('sla aparece consistentemente na fila Needs Attention e no histórico (mesmo objeto, mesma fonte)', async () => {
    const incident = await insertIncident(`e-queue-${suffix}`, 'critical');

    const queue = await listAttentionQueue({ entityType, entityId: `e-queue-${suffix}`, page: 1, limit: 10 });
    const historyRow = (await listSupervisionIncidents({ entityType, entityId: `e-queue-${suffix}`, page: 1, limit: 10 })).rows[0];

    assert.equal(queue.rows.length, 1);
    assert.equal(queue.rows[0]!.sla.status, 'within_sla');
    assert.equal(historyRow!.sla.status, 'within_sla');
    assert.equal(queue.rows[0]!.sla.deadlineAt, historyRow!.sla.deadlineAt);
  });
});
