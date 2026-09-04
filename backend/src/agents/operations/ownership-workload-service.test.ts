import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentAssignments, agentOperationalIncidentReviews, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { assignIncident, getIncidentAssignment, unassignIncident } from './incident-assignment-service.js';
import { upsertIncidentReview } from './incident-review-service.js';
import { getOperationalOwnershipWorkload, listAttentionQueue } from './supervision-insights-service.js';

/**
 * Agentes v3.9 (correio.md "Operational Ownership Workload & Human
 * Coordination Views", "11. Testes obrigatórios") — roda contra o
 * Postgres de teste real. Mesma técnica de aging/incidentes sintéticos já
 * usada por attention-queue-service.test.ts (v3.7) e
 * incident-assignment-service.test.ts (v3.8): audits
 * `agents.operations.incident.detected` inseridos diretamente.
 *
 * `totals.active/assigned/unassigned` de `getOperationalOwnershipWorkload`
 * são GLOBAIS (o contrato pedido pelo correio.md não previu escopo/filtro
 * — seção 4) — testados só via a invariante estrutural (sempre
 * verdadeira, independente de dados de outros testes) ou via DELTA
 * (depois − antes), nunca por igualdade absoluta. Tudo que precisa de um
 * número EXATO por responsável usa um usuário assignee CRIADO NA HORA
 * (`createAssignee()`, um por teste que precisa de isolamento) — o único
 * jeito de garantir "esse contador só pode refletir o que este teste fez"
 * neste banco compartilhado pela suíte inteira (nunca reaproveitando o
 * mesmo assignee entre testes, o que corromperia contagens absolutas).
 */
describe('Agentes v3.9 - ownership-workload-service (getOperationalOwnershipWorkload)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const entityType = `workload_test_${suffix}`;

  let ceoUserId: number;
  let ceoRoleId: number;
  const auditLogIds: number[] = [];
  const userIds: number[] = [];

  async function insertIncident(entityId: string, severity: 'info' | 'warning' | 'critical' = 'info') {
    const [row] = await db
      .insert(auditLogs)
      .values({
        actorType: 'system',
        action: 'agents.operations.incident.detected',
        entityType,
        entityId,
        metadata: { incidentType: 'operational_degradation', severity, response: 'observe', dryRun: false, reason: 'fixture v3.9' },
      })
      .returning();
    auditLogIds.push(row!.id);
    return row!;
  }

  async function createAssignee(label: string): Promise<number> {
    const [user] = await db.insert(users).values({ name: `Workload ${label} ${suffix}-${Math.random().toString(36).slice(2, 8)}`, email: `workload-${label}-${suffix}-${Math.random().toString(36).slice(2, 8)}@example.com`, passwordHash: 'x', roleId: ceoRoleId, isActive: true }).returning();
    userIds.push(user!.id);
    return user!.id;
  }

  function findAssignee(workload: Awaited<ReturnType<typeof getOperationalOwnershipWorkload>>, userId: number) {
    return workload.assignees.find((a) => a.userId === userId);
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;
    ceoRoleId = ceoUser.roleId;
  });

  after(async () => {
    await db.delete(agentOperationalIncidentAssignments).where(inArray(agentOperationalIncidentAssignments.incidentAuditLogId, auditLogIds));
    await db.delete(agentOperationalIncidentReviews).where(inArray(agentOperationalIncidentReviews.incidentAuditLogId, auditLogIds));
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditLogIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await database.end();
    redis.disconnect();
  });

  test('4: assigned + unassigned === active (invariante estrutural, sempre verdadeira)', async () => {
    await insertIncident(`e4-${suffix}`);
    const workload = await getOperationalOwnershipWorkload();
    assert.equal(workload.totals.assigned + workload.totals.unassigned, workload.totals.active);
  });

  test('1/2/9: incidente atribuído aparece no responsável correto; não atribuído só conta em unassigned; assign reflete no workload', async () => {
    const assigneeId = await createAssignee('a1');
    const before1 = await getOperationalOwnershipWorkload();
    assert.equal(findAssignee(before1, assigneeId), undefined, 'assignee recém-criado não deveria aparecer ainda');

    const assigned = await insertIncident(`e1-${suffix}`);
    await insertIncident(`e2-${suffix}`); // permanece não atribuído

    await assignIncident(assigned.id, assigneeId, ceoUserId);

    const after1 = await getOperationalOwnershipWorkload();
    const entry = findAssignee(after1, assigneeId);
    assert.ok(entry, 'assignee deveria aparecer na lista após um assign');
    assert.equal(entry!.incidentCount, 1);
    assert.equal(entry!.bySeverity.info, 1);

    assert.equal(after1.totals.unassigned - before1.totals.unassigned, 1, 'só o incidente não atribuído deveria contar para o delta de unassigned');
    assert.equal(after1.totals.assigned - before1.totals.assigned, 1);
  });

  test('3/10: reassign decrementa o responsável anterior e incrementa o novo; incidente nunca aparece em dois responsáveis ao mesmo tempo', async () => {
    const assigneeAId = await createAssignee('a2');
    const assigneeBId = await createAssignee('b2');
    const incident = await insertIncident(`e3-${suffix}`);
    await assignIncident(incident.id, assigneeAId, ceoUserId);

    const afterAssign = await getOperationalOwnershipWorkload();
    assert.equal(findAssignee(afterAssign, assigneeAId)!.incidentCount, 1);
    assert.equal(findAssignee(afterAssign, assigneeBId), undefined);

    await assignIncident(incident.id, assigneeBId, ceoUserId);

    const afterReassign = await getOperationalOwnershipWorkload();
    const entryA = findAssignee(afterReassign, assigneeAId);
    const entryB = findAssignee(afterReassign, assigneeBId);
    assert.ok(!entryA || entryA.incidentCount === 0, 'responsável anterior deveria ter sido decrementado (o incidente saiu de sua conta)');
    assert.equal(entryB!.incidentCount, 1, 'novo responsável deveria ter sido incrementado');
  });

  test('11: unassign decrementa o responsável e incrementa unassigned', async () => {
    const assigneeId = await createAssignee('a3');
    const incident = await insertIncident(`e11-${suffix}`);
    await assignIncident(incident.id, assigneeId, ceoUserId);
    const afterAssign = await getOperationalOwnershipWorkload();
    assert.equal(findAssignee(afterAssign, assigneeId)!.incidentCount, 1);

    await unassignIncident(incident.id, ceoUserId);
    const afterUnassign = await getOperationalOwnershipWorkload();
    const entry = findAssignee(afterUnassign, assigneeId);
    assert.ok(!entry || entry.incidentCount === 0);
    assert.equal(afterUnassign.totals.unassigned - afterAssign.totals.unassigned, 1);
    assert.equal(afterUnassign.totals.assigned - afterAssign.totals.assigned, -1);
  });

  test('5/6: sum(bySeverity) === incidentCount; distribuição por reviewStatus correta', async () => {
    const assigneeId = await createAssignee('a4');
    const critical = await insertIncident(`e5-crit-${suffix}`, 'critical');
    const warning = await insertIncident(`e5-warn-${suffix}`, 'warning');
    const info = await insertIncident(`e5-info-${suffix}`, 'info');
    await Promise.all([assignIncident(critical.id, assigneeId, ceoUserId), assignIncident(warning.id, assigneeId, ceoUserId), assignIncident(info.id, assigneeId, ceoUserId)]);
    await upsertIncidentReview(warning.id, ceoUserId, { status: 'acknowledged' }); // critical e info ficam 'unreviewed'

    const workload = await getOperationalOwnershipWorkload();
    const entry = findAssignee(workload, assigneeId)!;
    assert.equal(entry.incidentCount, 3);
    assert.equal(entry.bySeverity.critical, 1);
    assert.equal(entry.bySeverity.warning, 1);
    assert.equal(entry.bySeverity.info, 1);
    assert.equal(Object.values(entry.bySeverity).reduce((sum, n) => sum + n, 0), entry.incidentCount, 'sum(bySeverity) deveria ser exatamente incidentCount');

    assert.equal(entry.byReviewStatus.acknowledged, 1);
    assert.equal(entry.byReviewStatus.unreviewed, 2);
    assert.equal(entry.byReviewStatus.acknowledged + entry.byReviewStatus.unreviewed, entry.incidentCount, 'sum(byReviewStatus) deveria ser exatamente incidentCount (população ativa só tem unreviewed/acknowledged)');
  });

  test('7/8/12/13: resolved sai do workload ativo default sem destruir o assignment; acknowledge não altera ownership', async () => {
    const assigneeId = await createAssignee('a5');
    const incident = await insertIncident(`e7-${suffix}`);
    await assignIncident(incident.id, assigneeId, ceoUserId);

    const beforeResolve = await getOperationalOwnershipWorkload();
    assert.equal(findAssignee(beforeResolve, assigneeId)!.incidentCount, 1);

    await upsertIncidentReview(incident.id, ceoUserId, { status: 'acknowledged' });
    const afterAcknowledge = await getOperationalOwnershipWorkload();
    assert.equal(findAssignee(afterAcknowledge, assigneeId)!.incidentCount, 1, 'acknowledge não deveria mudar a contagem de ownership (assign ≠ acknowledge)');
    assert.equal((await getIncidentAssignment(incident.id))!.assigneeUserId, assigneeId, 'acknowledge não deveria alterar quem é o responsável');

    await upsertIncidentReview(incident.id, ceoUserId, { status: 'resolved' });
    const afterResolve = await getOperationalOwnershipWorkload();
    assert.equal(findAssignee(afterResolve, assigneeId), undefined, 'incidente resolved não deveria mais contar no workload ativo');

    // 8/13: o assignment em si continua persistido — resolve não desatribui.
    const assignmentAfterResolve = await getIncidentAssignment(incident.id);
    assert.equal(assignmentAfterResolve!.assigneeUserId, assigneeId, 'resolve não deveria destruir/remover o assignment');
  });

  test('14: mesma regra de população da fila Needs Attention (v3.7) — um incidente resolved fica fora dos dois ao mesmo tempo', async () => {
    const assigneeId = await createAssignee('a6');
    const incident = await insertIncident(`e14-${suffix}`);
    await assignIncident(incident.id, assigneeId, ceoUserId);

    const activeWorkload = await getOperationalOwnershipWorkload();
    assert.equal(findAssignee(activeWorkload, assigneeId)!.incidentCount, 1);
    const activeQueue = await listAttentionQueue({ entityType, page: 1, limit: 100 });
    assert.ok(activeQueue.rows.some((row) => row.auditLogId === incident.id));

    await upsertIncidentReview(incident.id, ceoUserId, { status: 'resolved' });

    const resolvedWorkload = await getOperationalOwnershipWorkload();
    const resolvedQueue = await listAttentionQueue({ entityType, page: 1, limit: 100 });
    assert.equal(findAssignee(resolvedWorkload, assigneeId), undefined);
    assert.ok(!resolvedQueue.rows.some((row) => row.auditLogId === incident.id), 'resolved já sai da fila Needs Attention default (regra v3.7 intocada)');
  });

  test('22: ausência de N+1 — número de queries independe da quantidade de incidentes/responsáveis', async () => {
    const assigneeAId = await createAssignee('a7');
    const assigneeBId = await createAssignee('b7');
    const small = await insertIncident(`e22-small-${suffix}`);
    await assignIncident(small.id, assigneeAId, ceoUserId);

    async function countSelects(): Promise<number> {
      let selectCount = 0;
      const originalSelect = db.select.bind(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db as any).select = (...args: unknown[]) => {
        selectCount += 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalSelect as any)(...args);
      };
      try {
        await getOperationalOwnershipWorkload();
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (db as any).select = originalSelect;
      }
      return selectCount;
    }

    const smallCount = await countSelects();

    const largeIncidents = await Promise.all(Array.from({ length: 8 }, (_, i) => insertIncident(`e22-large-${i}-${suffix}`)));
    await Promise.all(largeIncidents.map((incident, i) => assignIncident(incident.id, i % 2 === 0 ? assigneeAId : assigneeBId, ceoUserId)));

    const largeCount = await countSelects();

    assert.equal(smallCount, 2, 'getOperationalOwnershipWorkload deveria custar exatamente 2 queries agregadas');
    assert.equal(smallCount, largeCount, 'número de queries deveria ser constante independente do volume de incidentes/responsáveis');
  });
});
