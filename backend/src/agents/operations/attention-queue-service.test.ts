import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalIncidentReviews, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { upsertIncidentReview } from './incident-review-service.js';
import { listAttentionQueue } from './supervision-insights-service.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Agentes v3.7 (correio.md "Operational Incident Review Queue & Attention
 * Management", "Testes obrigatórios") — roda contra o Postgres de teste
 * real. Diferente de supervision-insights-service.test.ts (que produz
 * incidentes REAIS via `runObservedOperationalSupervision`), aqui os
 * audits `agents.operations.incident.detected` são inseridos diretamente
 * (mesma identidade canônica — a única exigida pelo correio.md: "é
 * exatamente um `agents.operations.incident.detected`"), com `createdAt`
 * controlado. Isso é o que permite testar aging/ordenação/desempate de
 * forma determinística, sem sleeps reais — o `now` injetável de
 * `listAttentionQueue` faz o resto (correio.md: "preferir relógio
 * controlável/injetável nos testes de aging").
 */
describe('Agentes v3.7 - attention-queue-service (listAttentionQueue)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const entityType = `attn_test_${suffix}`;

  let ceoUserId: number;
  const auditLogIds: number[] = [];

  async function insertIncident(opts: { entityId: string; severity?: 'info' | 'warning' | 'critical'; incidentType?: string; response?: string; createdAt: Date }) {
    const [row] = await db
      .insert(auditLogs)
      .values({
        actorType: 'system',
        action: 'agents.operations.incident.detected',
        entityType,
        entityId: opts.entityId,
        metadata: { incidentType: opts.incidentType ?? 'operational_degradation', severity: opts.severity ?? 'info', response: opts.response ?? 'observe', dryRun: false, reason: 'fixture v3.7' },
        createdAt: opts.createdAt,
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
  });

  after(async () => {
    await db.delete(agentOperationalIncidentReviews).where(inArray(agentOperationalIncidentReviews.incidentAuditLogId, auditLogIds));
    await db.delete(auditLogs).where(inArray(auditLogs.id, auditLogIds));
    await database.end();
    redis.disconnect();
  });

  test('1/18: incidente unreviewed aparece na fila, sintetizado corretamente (nenhuma linha de review persistida)', async () => {
    const now = new Date();
    const incident = await insertIncident({ entityId: `e1-${suffix}`, createdAt: now });

    const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 50, now: new Date(now.getTime() + 1000) });
    const found = rows.find((r) => r.auditLogId === incident.id);
    assert.ok(found, 'incidente unreviewed deveria aparecer na fila por default');
    assert.equal(found!.reviewStatus, 'unreviewed');
    assert.ok(found!.attentionReasons.includes('unreviewed'));
  });

  test('2/3: acknowledged ainda aparece; resolved/dismissed ficam fora por default mas acessíveis via filtro explícito', async () => {
    const now = new Date();
    const ack = await insertIncident({ entityId: `e2-ack-${suffix}`, createdAt: now });
    const resolved = await insertIncident({ entityId: `e2-resolved-${suffix}`, createdAt: now });
    const dismissed = await insertIncident({ entityId: `e2-dismissed-${suffix}`, createdAt: now });

    await upsertIncidentReview(ack.id, ceoUserId, { status: 'acknowledged' });
    await upsertIncidentReview(resolved.id, ceoUserId, { status: 'resolved' });
    await upsertIncidentReview(dismissed.id, ceoUserId, { status: 'dismissed' });

    const readAt = new Date(now.getTime() + 1000);
    const defaultQueue = await listAttentionQueue({ entityType, page: 1, limit: 100, now: readAt });
    assert.ok(defaultQueue.rows.some((r) => r.auditLogId === ack.id), 'acknowledged deveria continuar aparecendo por default');
    assert.ok(!defaultQueue.rows.some((r) => r.auditLogId === resolved.id), 'resolved não deveria aparecer por default');
    assert.ok(!defaultQueue.rows.some((r) => r.auditLogId === dismissed.id), 'dismissed não deveria aparecer por default');

    const resolvedOnly = await listAttentionQueue({ entityType, page: 1, limit: 100, now: readAt, reviewStatus: 'resolved' });
    assert.ok(resolvedOnly.rows.some((r) => r.auditLogId === resolved.id), 'filtro explícito reviewStatus=resolved deveria trazer o incidente resolvido');
    assert.ok(!resolvedOnly.rows.some((r) => r.auditLogId === ack.id));

    const dismissedOnly = await listAttentionQueue({ entityType, page: 1, limit: 100, now: readAt, reviewStatus: 'dismissed' });
    assert.ok(dismissedOnly.rows.some((r) => r.auditLogId === dismissed.id), 'filtro explícito reviewStatus=dismissed deveria trazer o incidente dispensado');
  });

  test('4/13: severidade influencia a ordenação (critical > warning > info, no mesmo instante)', async () => {
    const now = new Date();
    const info = await insertIncident({ entityId: `e4-info-${suffix}`, severity: 'info', createdAt: now });
    const warning = await insertIncident({ entityId: `e4-warn-${suffix}`, severity: 'warning', createdAt: now });
    const critical = await insertIncident({ entityId: `e4-crit-${suffix}`, severity: 'critical', createdAt: now });

    const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(now.getTime() + 1000), incidentType: 'operational_degradation' });
    const ids = rows.map((r) => r.auditLogId).filter((id) => [info.id, warning.id, critical.id].includes(id));
    assert.deepEqual(ids, [critical.id, warning.id, info.id], 'ordem esperada: critical, depois warning, depois info');
  });

  test('5/14: recorrência influencia a ordenação (mesma severidade, recorrente vem antes)', async () => {
    const t0 = new Date();
    const t1 = new Date(t0.getTime() + 1000);
    const single = await insertIncident({ entityId: `e5-single-${suffix}`, severity: 'warning', incidentType: 'run_stuck', createdAt: t0 });
    const recurringA = await insertIncident({ entityId: `e5-recurring-${suffix}`, severity: 'warning', incidentType: 'run_stuck', createdAt: t0 });
    // Segunda ocorrência do MESMO incidente (mesma incidentType+entityType+entityId) — exatamente a definição de recorrência já usada por listRecurringIncidents (v3.5).
    await insertIncident({ entityId: `e5-recurring-${suffix}`, severity: 'warning', incidentType: 'run_stuck', createdAt: t1 });

    const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(t1.getTime() + 1000), incidentType: 'run_stuck' });
    const recurringRow = rows.find((r) => r.auditLogId === recurringA.id);
    const singleRow = rows.find((r) => r.auditLogId === single.id);
    assert.ok(recurringRow && singleRow);
    assert.ok(recurringRow!.isRecurring);
    assert.equal(recurringRow!.recurrenceCount, 2);
    assert.ok(!singleRow!.isRecurring);
    assert.ok(rows.indexOf(recurringRow!) < rows.indexOf(singleRow!), 'incidente recorrente deveria vir antes do não recorrente, mesma severidade');
  });

  test('6-10: aging - buckets <1h, exatamente 1h, exatamente 4h, exatamente 24h e >24h', async () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const incident = await insertIncident({ entityId: `e6-${suffix}`, createdAt: t0 });

    const cases: { offsetMs: number; expected: '<1h' | '1h-4h' | '4h-24h' | '>24h' }[] = [
      { offsetMs: 30 * 60 * 1000, expected: '<1h' }, // 30min
      { offsetMs: 1 * HOUR_MS, expected: '1h-4h' }, // exatamente 1h
      { offsetMs: 4 * HOUR_MS, expected: '4h-24h' }, // exatamente 4h
      { offsetMs: 24 * HOUR_MS, expected: '>24h' }, // exatamente 24h
      { offsetMs: 25 * HOUR_MS, expected: '>24h' }, // > 24h
    ];

    for (const { offsetMs, expected } of cases) {
      const now = new Date(t0.getTime() + offsetMs);
      const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 200, now });
      const row = rows.find((r) => r.auditLogId === incident.id);
      assert.ok(row, `incidente deveria aparecer com now=t0+${offsetMs}ms`);
      assert.equal(row!.agingBucket, expected, `aging bucket incorreto para offset ${offsetMs}ms`);
      assert.equal(row!.ageMs, offsetMs);
    }
  });

  test('11: desempate determinístico (mesma severidade/recorrência/review/idade → auditLogId ascendente)', async () => {
    const t0 = new Date();
    const first = await insertIncident({ entityId: `e11-a-${suffix}`, severity: 'warning', incidentType: 'approval_bottleneck', createdAt: t0 });
    const second = await insertIncident({ entityId: `e11-b-${suffix}`, severity: 'warning', incidentType: 'approval_bottleneck', createdAt: t0 });
    assert.ok(second.id > first.id, 'pré-condição do teste: ids devem ser crescentes na ordem de inserção');

    const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(t0.getTime() + 1000), incidentType: 'approval_bottleneck' });
    const firstIdx = rows.findIndex((r) => r.auditLogId === first.id);
    const secondIdx = rows.findIndex((r) => r.auditLogId === second.id);
    assert.ok(firstIdx !== -1 && secondIdx !== -1);
    assert.ok(firstIdx < secondIdx, 'com todos os outros critérios empatados, o auditLogId menor deveria vir primeiro');
  });

  test('12/8: filtros combinados (severity + reviewStatus) funcionam em conjunto', async () => {
    const now = new Date();
    const matches = await insertIncident({ entityId: `e12-match-${suffix}`, severity: 'critical', incidentType: 'delivery_failure', createdAt: now });
    const wrongSeverity = await insertIncident({ entityId: `e12-wrong-sev-${suffix}`, severity: 'info', incidentType: 'delivery_failure', createdAt: now });
    const wrongReview = await insertIncident({ entityId: `e12-wrong-review-${suffix}`, severity: 'critical', incidentType: 'delivery_failure', createdAt: now });
    await upsertIncidentReview(wrongReview.id, ceoUserId, { status: 'acknowledged' });

    const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(now.getTime() + 1000), severity: 'critical', reviewStatus: 'unreviewed', incidentType: 'delivery_failure' });
    const ids = rows.map((r) => r.auditLogId);
    assert.ok(ids.includes(matches.id));
    assert.ok(!ids.includes(wrongSeverity.id));
    assert.ok(!ids.includes(wrongReview.id));
  });

  test('9: filtro por recorrência (recurringOnly)', async () => {
    const t0 = new Date();
    const t1 = new Date(t0.getTime() + 1000);
    const nonRecurring = await insertIncident({ entityId: `e9-nonrec-${suffix}`, incidentType: 'manual_attention_required', createdAt: t0 });
    const recurringFirst = await insertIncident({ entityId: `e9-rec-${suffix}`, incidentType: 'manual_attention_required', createdAt: t0 });
    await insertIncident({ entityId: `e9-rec-${suffix}`, incidentType: 'manual_attention_required', createdAt: t1 });

    const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(t1.getTime() + 1000), incidentType: 'manual_attention_required', recurringOnly: true });
    const ids = rows.map((r) => r.auditLogId);
    assert.ok(ids.includes(recurringFirst.id));
    assert.ok(!ids.includes(nonRecurring.id));
  });

  test('outcome: incidente `observe`/sem audit de resultado é sintetizado como outcome=observed e filtrável', async () => {
    const now = new Date();
    const incident = await insertIncident({ entityId: `e-outcome-${suffix}`, response: 'observe', createdAt: now });

    const { rows } = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(now.getTime() + 1000), outcome: 'observed' });
    assert.ok(rows.some((r) => r.auditLogId === incident.id));

    const { rows: none } = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(now.getTime() + 1000), outcome: 'recovered' });
    assert.ok(!none.some((r) => r.auditLogId === incident.id));
  });

  test('16: paginação preserva ordenação determinística', async () => {
    const now = new Date();
    const critIds: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const row = await insertIncident({ entityId: `e16-${i}-${suffix}`, severity: 'critical', incidentType: 'autonomy_circuit_open', createdAt: new Date(now.getTime() + i) });
      critIds.push(row.id);
    }

    const readAt = new Date(now.getTime() + 10000);
    const full = await listAttentionQueue({ entityType, page: 1, limit: 100, now: readAt, incidentType: 'autonomy_circuit_open' });
    const fullOrder = full.rows.map((r) => r.auditLogId).filter((id) => critIds.includes(id));

    const page1 = await listAttentionQueue({ entityType, page: 1, limit: 2, now: readAt, incidentType: 'autonomy_circuit_open' });
    const page2 = await listAttentionQueue({ entityType, page: 2, limit: 2, now: readAt, incidentType: 'autonomy_circuit_open' });
    const page3 = await listAttentionQueue({ entityType, page: 3, limit: 2, now: readAt, incidentType: 'autonomy_circuit_open' });
    const paginatedOrder = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.auditLogId).filter((id) => critIds.includes(id));

    assert.deepEqual(paginatedOrder, fullOrder, 'concatenar páginas deveria reproduzir exatamente a mesma ordem da busca sem paginação');
    assert.equal(full.total, page1.total, 'total deveria ser o mesmo independente da página pedida');
  });

  test('17: ausência de N+1 - número de queries independe da quantidade de incidentes retornados', async () => {
    const now = new Date();
    const small: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      small.push((await insertIncident({ entityId: `e17-small-${i}-${suffix}`, incidentType: 'operational_degradation', createdAt: now })).id);
    }
    const large: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      large.push((await insertIncident({ entityId: `e17-large-${i}-${suffix}`, incidentType: 'run_stuck', createdAt: now })).id);
    }

    const readAt = new Date(now.getTime() + 1000);

    async function countSelects(fn: () => Promise<unknown>): Promise<number> {
      let selectCount = 0;
      const originalSelect = db.select.bind(db);
      // Instrumentação só para este teste — restaurada no `finally` abaixo.
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

    const smallQueryCount = await countSelects(() => listAttentionQueue({ entityType, page: 1, limit: 50, now: readAt, incidentType: 'operational_degradation' }));
    const largeQueryCount = await countSelects(() => listAttentionQueue({ entityType, page: 1, limit: 50, now: readAt, incidentType: 'run_stuck' }));

    assert.ok(small.length === 2 && large.length === 9);
    assert.equal(smallQueryCount, largeQueryCount, `número de queries deveria ser constante independente do volume de linhas (2 incidentes: ${smallQueryCount} queries; 9 incidentes: ${largeQueryCount} queries)`);
  });

  test('19/20/21: review via v3.6 atualiza a projeção da fila, sem alterar outcome operacional nem a decisão do supervisor', async () => {
    const now = new Date();
    const incident = await insertIncident({ entityId: `e19-${suffix}`, response: 'observe', createdAt: now });

    const before1 = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(now.getTime() + 1000) });
    const beforeRow = before1.rows.find((r) => r.auditLogId === incident.id);
    assert.ok(beforeRow);
    assert.equal(beforeRow!.reviewStatus, 'unreviewed');
    assert.equal(beforeRow!.outcome, 'observed');
    assert.equal(beforeRow!.response, 'observe');

    await upsertIncidentReview(incident.id, ceoUserId, { status: 'acknowledged', note: 'em análise' });

    const after1 = await listAttentionQueue({ entityType, page: 1, limit: 100, now: new Date(now.getTime() + 2000) });
    const afterRow = after1.rows.find((r) => r.auditLogId === incident.id);
    assert.ok(afterRow, 'incidente acknowledged ainda deveria aparecer na fila');
    assert.equal(afterRow!.reviewStatus, 'acknowledged', 'projeção da fila deveria refletir o novo status de review');
    // Outcome operacional e a decisão (`response`) do Supervisor nunca são
    // tocados por uma mudança de review (correio.md: "alterar review NÃO
    // altera o outcome operacional"; "nenhuma alteração indireta na
    // decisão/resposta do Supervisor").
    assert.equal(afterRow!.outcome, 'observed');
    assert.equal(afterRow!.response, 'observe');
  });
});
