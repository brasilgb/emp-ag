import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentOperationalFollowUps, agentOperationalIncidentAssignments, agentOperationalIncidentReviews, agentResponsibilities, agents, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { assignIncident, unassignIncident } from './incident-assignment-service.js';
import { upsertIncidentReview } from './incident-review-service.js';
import { getSupervisionIncidentDetail, sortOperationalIncidentTimelineEvents } from './supervision-insights-service.js';
import type { OperationalIncidentTimelineEvent } from './supervision-insights-service.js';

/**
 * Agentes v4.0 (correio.md "Operational Incident Collaboration &
 * Activity Timeline", "19. Testes backend obrigatórios") — roda contra o
 * Postgres de teste real. Audits `agents.operations.incident.detected`
 * inseridos diretamente (mesma identidade canônica) para incidentes
 * isolados; review/assignment produzidos via os serviços reais
 * (`upsertIncidentReview`/`assignIncident`/`unassignIncident`) para que
 * seus audits de histórico (v3.6/v3.8) sejam exatamente os mesmos que a
 * timeline consome em produção. Escalation/FollowUp inseridos
 * diretamente com o MESMO vínculo determinístico (`metadata.incidentId`/
 * `escalationId`) que o código de produção usa — sem depender de rodar o
 * Supervisor inteiro.
 */
describe('Agentes v4.0 - incident-timeline (getSupervisionIncidentDetail.timeline)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const entityType = `timeline_test_${suffix}`;

  let ceoUserId: number;
  let assigneeAId: number;
  let assigneeBId: number;
  let directorAgentId: number;
  let responsibilityId: number;
  const auditLogIds: number[] = [];
  const userIds: number[] = [];
  const escalationIds: number[] = [];
  const followUpIds: number[] = [];

  async function insertIncident(entityId: string) {
    const [row] = await db
      .insert(auditLogs)
      .values({
        actorType: 'system',
        action: 'agents.operations.incident.detected',
        entityType,
        entityId,
        metadata: { incidentType: 'operational_degradation', severity: 'warning', response: 'observe', dryRun: false, reason: 'fixture v4.0' },
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

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;

    const [assigneeA] = await db.insert(users).values({ name: `Timeline Assignee A ${suffix}`, email: `timeline-assignee-a-${suffix}@example.com`, passwordHash: 'x', roleId: ceoUser.roleId, isActive: true }).returning();
    const [assigneeB] = await db.insert(users).values({ name: `Timeline Assignee B ${suffix}`, email: `timeline-assignee-b-${suffix}@example.com`, passwordHash: 'x', roleId: ceoUser.roleId, isActive: true }).returning();
    assigneeAId = assigneeA!.id;
    assigneeBId = assigneeB!.id;
    userIds.push(assigneeAId, assigneeBId);

    const [responsibility] = await db
      .insert(agentResponsibilities)
      .values({ agentId: directorAgentId, name: `Timeline Responsibility ${suffix}`, domain: 'agents', responsibilityType: 'monitor', priority: 'critical', escalationPolicy: 'agent', escalationTargetAgentId: directorAgentId, createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;
  });

  after(async () => {
    if (followUpIds.length > 0) await db.delete(agentOperationalFollowUps).where(inArray(agentOperationalFollowUps.id, followUpIds));
    if (escalationIds.length > 0) await db.delete(agentOperationalEscalations).where(inArray(agentOperationalEscalations.id, escalationIds));
    await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, responsibilityId));
    await db.delete(agentOperationalIncidentAssignments).where(inArray(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogIds));
    await db.delete(agentOperationalIncidentReviews).where(inArray(agentOperationalIncidentReviews.incidentAuditLogId, auditLogIds));
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditLogIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await database.end();
    redis.disconnect();
  });

  test('1/15/16/17: incidente recém-detectado, sem review/assignment/escalation/follow-up, mostra só o evento de detecção', async () => {
    const incident = await insertIncident(`e1-${suffix}`);
    const detail = await getSupervisionIncidentDetail(incident.id);
    assert.ok(detail);
    assert.equal(detail!.timeline.length, 1);
    assert.equal(detail!.timeline[0]!.type, 'incident_detected');
    assert.equal(detail!.timeline[0]!.id, `detected:${incident.id}`);
    assert.equal(detail!.timeline[0]!.actorUserId, null, 'incidente detectado pelo scheduler automático nunca deveria ter um actorUserId inventado');
  });

  test('2/3/4/5/6: ciclo completo de review + assignment aparece cronologicamente e com from/to corretos', async () => {
    const incident = await insertIncident(`e2-${suffix}`);

    await upsertIncidentReview(incident.id, ceoUserId, { status: 'acknowledged' });
    await assignIncident(incident.id, assigneeAId, ceoUserId);
    await assignIncident(incident.id, assigneeBId, ceoUserId); // reassign
    await upsertIncidentReview(incident.id, ceoUserId, { status: 'resolved' });
    await unassignIncident(incident.id, ceoUserId);

    const detail = await getSupervisionIncidentDetail(incident.id);
    assert.ok(detail);
    const types = detail!.timeline.map((e) => e.type);
    assert.deepEqual(types, ['incident_detected', 'review_acknowledged', 'assigned', 'reassigned', 'review_status_changed', 'unassigned'], 'ordem cronológica exata esperada para esta sequência de ações');

    const ack = detail!.timeline.find((e) => e.type === 'review_acknowledged')!;
    assert.equal(ack.from, 'unreviewed');
    assert.equal(ack.to, 'acknowledged');
    assert.equal(ack.actorUserId, ceoUserId);

    const assigned = detail!.timeline.find((e) => e.type === 'assigned')!;
    assert.equal(assigned.from, null);
    assert.equal(assigned.to, assigneeAId);

    const reassigned = detail!.timeline.find((e) => e.type === 'reassigned')!;
    assert.equal(reassigned.from, assigneeAId);
    assert.equal(reassigned.to, assigneeBId);

    const resolved = detail!.timeline.find((e) => e.type === 'review_status_changed')!;
    assert.equal(resolved.from, 'acknowledged');
    assert.equal(resolved.to, 'resolved');

    const unassigned = detail!.timeline.find((e) => e.type === 'unassigned')!;
    assert.equal(unassigned.from, assigneeBId);
    assert.equal(unassigned.to, null);
  });

  test('7/8: escalation e follow-up relacionados aparecem quando o vínculo existe', async () => {
    const incident = await insertIncident(`e7-${suffix}`);
    const incidentId = `operational_degradation:${entityType}:e7-${suffix}`;

    const [escalation] = await db
      .insert(agentOperationalEscalations)
      .values({
        responsibilityId,
        sourceAgentId: directorAgentId,
        targetAgentId: directorAgentId,
        reason: 'fixture v4.0',
        severity: 'critical',
        status: 'open',
        dedupKey: `timeline-fixture-${suffix}-e7`,
        metadata: { incidentType: 'operational_degradation', incidentId },
      })
      .returning();
    escalationIds.push(escalation!.id);

    const [followUp] = await db
      .insert(agentOperationalFollowUps)
      .values({
        responsibilityId,
        escalationId: escalation!.id,
        sourceType: 'escalation',
        sourceId: escalation!.id,
        ownerAgentId: directorAgentId,
        title: `Timeline FollowUp ${suffix}`,
        dedupKey: `timeline-fixture-followup-${suffix}-e7`,
      })
      .returning();
    followUpIds.push(followUp!.id);

    const detail = await getSupervisionIncidentDetail(incident.id);
    assert.ok(detail);
    const escalationEvent = detail!.timeline.find((e) => e.type === 'escalation_created');
    assert.ok(escalationEvent, 'escalation vinculada por incidentId deveria aparecer na timeline');
    assert.equal(escalationEvent!.id, `escalation:${escalation!.id}`);
    assert.equal(escalationEvent!.actorUserId, null, 'escalation é criada pelo sistema, nunca por um humano — nunca inventar ator');

    const followUpEvent = detail!.timeline.find((e) => e.type === 'follow_up_created');
    assert.ok(followUpEvent, 'follow-up vinculado à escalation deveria aparecer na timeline');
    assert.equal(followUpEvent!.id, `followup:${followUp!.id}`);
  });

  test('9: eventos de outro incidente nunca aparecem', async () => {
    const incidentA = await insertIncident(`e9-a-${suffix}`);
    const incidentB = await insertIncident(`e9-b-${suffix}`);

    await assignIncident(incidentA.id, assigneeAId, ceoUserId);
    await assignIncident(incidentB.id, assigneeBId, ceoUserId);

    const detailA = await getSupervisionIncidentDetail(incidentA.id);
    const detailB = await getSupervisionIncidentDetail(incidentB.id);

    assert.ok(detailA && detailB);
    assert.ok(detailA!.timeline.some((e) => e.type === 'assigned' && e.to === assigneeAId));
    assert.ok(!detailA!.timeline.some((e) => e.type === 'assigned' && e.to === assigneeBId), 'evento do incidente B nunca deveria vazar para a timeline do incidente A');
    assert.ok(detailB!.timeline.some((e) => e.type === 'assigned' && e.to === assigneeBId));
    assert.ok(!detailB!.timeline.some((e) => e.type === 'assigned' && e.to === assigneeAId));
  });

  test('10: ordenação é determinística mesmo com timestamps empatados (função pura, sem banco)', () => {
    const sameInstant = '2026-01-01T00:00:00.000Z';
    const events: OperationalIncidentTimelineEvent[] = [
      { id: 'followup:5', type: 'follow_up_created', occurredAt: sameInstant, actorUserId: null },
      { id: 'escalation:3', type: 'escalation_created', occurredAt: sameInstant, actorUserId: null },
      { id: 'review:9', type: 'review_status_changed', occurredAt: sameInstant, actorUserId: 1 },
      { id: 'assignment:2', type: 'assigned', occurredAt: sameInstant, actorUserId: 1 },
      { id: 'detected:1', type: 'incident_detected', occurredAt: sameInstant, actorUserId: null },
      { id: 'review:8', type: 'review_status_changed', occurredAt: sameInstant, actorUserId: 1 }, // mesmo rank do review:9 acima — desempate por id numérico
    ];

    const sorted1 = sortOperationalIncidentTimelineEvents(events);
    const sorted2 = sortOperationalIncidentTimelineEvents([...events].reverse());

    assert.deepEqual(
      sorted1.map((e) => e.id),
      ['detected:1', 'assignment:2', 'review:8', 'review:9', 'escalation:3', 'followup:5'],
    );
    assert.deepEqual(sorted1.map((e) => e.id), sorted2.map((e) => e.id), 'a ordem final não deveria depender da ordem de entrada — sempre o mesmo resultado');
  });

  test('18: ausência de N+1 — timeline de um incidente com muitos eventos custa o mesmo número de queries que um com poucos', async () => {
    const small = await insertIncident(`e18-small-${suffix}`);
    await assignIncident(small.id, assigneeAId, ceoUserId);

    const large = await insertIncident(`e18-large-${suffix}`);
    await upsertIncidentReview(large.id, ceoUserId, { status: 'acknowledged' });
    await assignIncident(large.id, assigneeAId, ceoUserId);
    await assignIncident(large.id, assigneeBId, ceoUserId);
    await upsertIncidentReview(large.id, ceoUserId, { status: 'resolved' });
    await upsertIncidentReview(large.id, ceoUserId, { status: 'dismissed' });
    await unassignIncident(large.id, ceoUserId);

    async function countSelects(auditLogId: number): Promise<number> {
      let selectCount = 0;
      const originalSelect = db.select.bind(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = (...args: unknown[]) => {
        selectCount += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalSelect as any)(...args);
      };
      try {
        await getSupervisionIncidentDetail(auditLogId);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).select = originalSelect;
      }
      return selectCount;
    }

    const smallCount = await countSelects(small.id);
    const largeCount = await countSelects(large.id);

    assert.equal(smallCount, largeCount, `número de queries deveria ser constante independente do volume de eventos (pequeno: ${smallCount}, grande: ${largeCount})`);
  });
});
