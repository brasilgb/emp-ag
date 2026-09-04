import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentJobRuns, agentJobs, agentOperationalIncidentReviews, agents, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { getIncidentReview, getIncidentReviewsByAuditLogIds, upsertIncidentReview } from './incident-review-service.js';
import { runObservedOperationalSupervision } from './supervision-run-history.js';

/*
 * Agentes v3.6 (correio.md "Operational Incident Acknowledgement & Review
 * Workflow", "11. Testes obrigatórios") — roda contra o Postgres de
 * teste real, um incidente REAL produzido por
 * `runObservedOperationalSupervision` (mesma técnica de
 * supervision-insights-service.test.ts) — nenhum mock do Supervisor.
 */
describe('Agentes v3.6 - incident-review-service (workflow de revisão humana)', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let directorAgentId: number;

  const jobIds: number[] = [];
  const runIds: number[] = [];

  async function insertFailingJob() {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Review Job ${runId}-${Math.random()}`,
        objective: 'objetivo de teste',
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'internal_event',
        autonomyEnabled: true,
      })
      .returning();
    jobIds.push(job!.id);

    for (let index = 0; index < 5; index += 1) {
      const [run] = await db.insert(agentJobRuns).values({ jobId: job!.id, triggerType: 'internal_event', status: 'failed', startedAt: new Date() }).returning();
      runIds.push(run!.id);
    }

    return job!;
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
  });

  after(async () => {
    for (const id of runIds) await db.delete(agentJobRuns).where(eq(agentJobRuns.id, id));
    for (const id of jobIds) await db.delete(agentJobs).where(eq(agentJobs.id, id));

    await database.end();
    redis.disconnect();
  });

  test('1/2/3/4/5/6/12/16/17: ciclo completo — unreviewed → acknowledged → resolved/dismissed, ator/timestamp derivados, nota opcional, concorrência, sem dados sensíveis', async () => {
    const job = await insertFailingJob();
    const report = await runObservedOperationalSupervision({ dryRun: false, actorUserId: ceoUserId, triggeredBy: 'manual' });
    assert.equal(report.failed, 0);

    // Pode haver mais de um incidente no banco compartilhado da suíte —
    // busca especificamente o deste job (por entityId).
    const rows = await db.select({ id: auditLogs.id, entityId: auditLogs.entityId }).from(auditLogs).where(eq(auditLogs.action, 'agents.operations.incident.detected'));
    const jobIncident = rows.find((row) => row.entityId === String(job.id));
    assert.ok(jobIncident, 'setup: incidente do job deveria existir');
    const auditLogId = jobIncident!.id;

    // 1: incidente inicialmente sem review.
    const initial = await getIncidentReview(auditLogId);
    assert.ok(initial);
    assert.equal(initial!.status, 'unreviewed');
    assert.equal(initial!.reviewedBy, null);
    assert.equal(initial!.reviewedAt, null);
    assert.equal(initial!.note, null);

    // 2: unreviewed → acknowledged. 5: ator/timestamp derivados do backend
    // (nunca do payload).
    const before1 = new Date();
    const ack = await upsertIncidentReview(auditLogId, ceoUserId, { status: 'acknowledged' });
    assert.ok(ack.ok);
    assert.equal(ack.review.status, 'acknowledged');
    assert.equal(ack.review.reviewedBy, ceoUserId);
    assert.ok(ack.review.reviewedAt && new Date(ack.review.reviewedAt).getTime() >= before1.getTime());

    // 6: nota opcional.
    const withNote = await upsertIncidentReview(auditLogId, ceoUserId, { status: 'acknowledged', note: 'Investigando causa raiz.' });
    assert.ok(withNote.ok);
    assert.equal(withNote.review.note, 'Investigando causa raiz.');

    // 3: acknowledged → resolved.
    const resolved = await upsertIncidentReview(auditLogId, ceoUserId, { status: 'resolved' });
    assert.ok(resolved.ok);
    assert.equal(resolved.review.status, 'resolved');

    // 4: acknowledged → dismissed (a partir de resolved, também uma
    // transição válida — o vocabulário não impõe uma máquina de estados
    // rígida, correio.md seção 2 só define semântica, nunca uma ordem
    // obrigatória entre os 3 estados revisáveis).
    const dismissed = await upsertIncidentReview(auditLogId, ceoUserId, { status: 'dismissed' });
    assert.ok(dismissed.ok);
    assert.equal(dismissed.review.status, 'dismissed');

    // 12: getIncidentReview (usado pelo detalhe da v3.5) reflete o
    // último estado.
    const reloaded = await getIncidentReview(auditLogId);
    assert.equal(reloaded!.status, 'dismissed');

    // 16: concorrência — duas escritas "simultâneas" (Promise.all) sobre
    // o MESMO incidente nunca corrompem a linha (upsert atômico via
    // ON CONFLICT DO UPDATE) — sempre exatamente uma linha ao final, com
    // o status de uma das duas escritas (nunca um valor híbrido/corrompido).
    const [concurrentA, concurrentB] = await Promise.all([
      upsertIncidentReview(auditLogId, ceoUserId, { status: 'acknowledged' }),
      upsertIncidentReview(auditLogId, ceoUserId, { status: 'resolved' }),
    ]);
    assert.ok(concurrentA.ok && concurrentB.ok);
    const finalState = await getIncidentReview(auditLogId);
    assert.ok(['acknowledged', 'resolved'].includes(finalState!.status), 'estado final deveria ser um dos dois valores escritos, nunca corrompido');

    const rowsAfterConcurrency = await db.select().from(agentOperationalIncidentReviews).where(eq(agentOperationalIncidentReviews.incidentAuditLogId, auditLogId));
    assert.equal(rowsAfterConcurrency.length, 1, 'nunca deveria existir mais de uma linha para o mesmo incidente');

    // 17: payload sem dados sensíveis — nem a nota digitada, nem stack
    // trace nenhum, aparecem no audit trail (só no campo `note` da
    // própria tabela de review).
    const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.operations.incident_review.changed'));
    const serializedAudits = JSON.stringify(auditRows);
    for (const forbidden of ['Investigando causa raiz', 'password', 'token', 'secret', 'apiKey', ' at ']) {
      assert.ok(!serializedAudits.includes(forbidden), `audit trail nunca deveria conter "${forbidden}"`);
    }
    // 11: audit append-only real — pelo menos uma entrada por mudança de
    // status feita acima (6 chamadas de upsert bem-sucedidas).
    assert.ok(auditRows.length >= 6);
    assert.ok(auditRows.every((row) => typeof (row.metadata as { previousStatus?: unknown }).previousStatus === 'string'));
    assert.ok(auditRows.every((row) => typeof (row.metadata as { newStatus?: unknown }).newStatus === 'string'));
    assert.ok(auditRows.every((row) => typeof (row.metadata as { hasNote?: unknown }).hasNote === 'boolean'));
  });

  test('7/8/9: rejeita audit inexistente e audit que não é incident.detected; getIncidentReviewsByAuditLogIds em lote', async () => {
    // 8: incidente inexistente.
    assert.equal(await getIncidentReview(999999999), null);
    const rejected = await upsertIncidentReview(999999999, ceoUserId, { status: 'acknowledged' });
    assert.deepEqual(rejected, { ok: false, code: 'invalid_incident' });

    // 9: audit real que NÃO é `incident.detected` (ex.: `scan.started`,
    // sempre emitido por runOperationalSupervision) não pode receber
    // review.
    const [nonIncidentAudit] = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'agents.operations.scan.started')).orderBy(auditLogs.id).limit(1);
    assert.ok(nonIncidentAudit, 'setup: deveria existir ao menos um audit de scan.started na suíte');
    assert.equal(await getIncidentReview(nonIncidentAudit!.id), null);
    const rejectedWrongType = await upsertIncidentReview(nonIncidentAudit!.id, ceoUserId, { status: 'acknowledged' });
    assert.deepEqual(rejectedWrongType, { ok: false, code: 'invalid_incident' });

    // getIncidentReviewsByAuditLogIds (batch, usado por
    // supervision-insights-service.ts): array vazio → Map vazio, sem
    // query.
    assert.equal((await getIncidentReviewsByAuditLogIds([])).size, 0);
  });
});
