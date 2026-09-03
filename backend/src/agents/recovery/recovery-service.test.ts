import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentDirectorDecisions, agentDirectorGoals, agentDirectorInitiatives, agentExecutiveReviews, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { getRecoveryStatus, reconcileOne, runRecovery } from './recovery-service.js';

const HOUR_MS = 60 * 60 * 1000;

/*
 * Agentes v2.4 (correio.md seção 24) — orquestração (`runRecovery`),
 * dry-run, relatório estruturado, status agregado, auditoria.
 */
describe('Agentes v2.4 - Recovery Service (orquestração)', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let goalId: number;
  const reviewIds: number[] = [];
  const initiativeIds: number[] = [];

  async function insertStaleReview() {
    const now = new Date();
    const old = new Date(now.getTime() - HOUR_MS);
    const { agentActionPlans } = await import('../../db/schema/index.js');
    const [plan] = await db.insert(agentActionPlans).values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'completed' }).returning();
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId, title: `Recovery Svc ${runId}-${Math.random()}`, description: 'd', domain: 'crm', status: 'completed', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId, actionPlanId: plan!.id })
      .returning();
    initiativeIds.push(initiative!.id);

    const [review] = await db
      .insert(agentExecutiveReviews)
      .values({ goalId, initiativeId: initiative!.id, actionPlanId: plan!.id, createdBy: ceoUserId, reviewType: 'initiative_outcome', status: 'draft', evidence: {}, updatedAt: old })
      .returning();
    reviewIds.push(review!.id);
    return review!;
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({ title: `Goal p/ Recovery Svc ${runId}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', createdBy: ceoUserId, startDate: new Date('2026-01-01T00:00:00.000Z'), targetDate: new Date('2026-12-01T00:00:00.000Z'), targetType: 'milestone' })
      .returning();
    goalId = goal!.id;
  });

  after(async () => {
    for (const id of reviewIds) await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, id));
    for (const id of initiativeIds) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, goalId));

    await database.end();
    redis.disconnect();
  });

  test('22/23/24: dry-run detecta os mesmos stale items, não altera banco, nenhum side effect', async () => {
    const review = await insertStaleReview();

    const report = await runRecovery({ dryRun: true, actorUserId: ceoUserId, thresholdSeconds: 60 });
    const item = report.items.find((entry) => entry.workflowType === 'executive_review' && entry.entityId === review.id);
    assert.ok(item, 'dry-run deveria ter detectado o mesmo stale item');
    assert.equal(item!.result, 'reverted', 'dry-run reporta qual AÇÃO SERIA aplicada, sem aplicá-la');

    const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.ok(reloaded, 'dry-run nunca altera o banco — a linha draft continua existindo');
    assert.equal(reloaded!.status, 'draft');
  });

  test('relatório estruturado: campos obrigatórios presentes e reconciliáveis matematicamente', async () => {
    const review = await insertStaleReview();

    const report = await runRecovery({ dryRun: false, actorUserId: ceoUserId, thresholdSeconds: 60 });

    assert.ok(report.startedAt);
    assert.ok(report.finishedAt);
    assert.equal(report.dryRun, false);
    assert.equal(report.thresholdSeconds, 60);
    assert.ok(report.scanned >= 1);
    assert.equal(report.stale, report.scanned);
    assert.equal(report.reverted + report.recovered + report.manualAttention + report.skipped, report.items.length);

    const item = report.items.find((entry) => entry.entityId === review.id);
    assert.ok(item);
    assert.equal(item!.result, 'reverted');
    assert.equal(item!.previousState, 'draft');
    assert.ok(item!.reason.length > 0);
    assert.ok(item!.timestamp);
  });

  test('25: agents.recovery.stale_detected é auditado para cada stale encontrado', async () => {
    const review = await insertStaleReview();
    await runRecovery({ dryRun: true, actorUserId: ceoUserId, thresholdSeconds: 60 });

    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'agents.recovery.stale_detected'), eq(auditLogs.entityType, 'agent_executive_review'), eq(auditLogs.entityId, String(review.id))));
    assert.ok(auditRow, 'deveria existir auditoria de stale_detected para esta review');
  });

  test('26: agents.recovery.reconciled contém entity/type/reason nos metadados', async () => {
    const review = await insertStaleReview();
    await runRecovery({ dryRun: false, actorUserId: ceoUserId, thresholdSeconds: 60 });

    const [auditRow] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'agents.recovery.reconciled'), eq(auditLogs.entityType, 'agent_executive_review'), eq(auditLogs.entityId, String(review.id))));
    assert.ok(auditRow, 'deveria existir auditoria de reconciled');
    const metadata = auditRow.metadata as { workflowType: string; previousState: string; result: string; reason: string };
    assert.equal(metadata.workflowType, 'executive_review');
    assert.equal(metadata.previousState, 'draft');
    assert.equal(metadata.result, 'reverted');
    assert.ok(metadata.reason);
  });

  test('27: manual_attention fica visível (Decision Item real na Director Decision Queue)', async () => {
    const old = new Date(Date.now() - HOUR_MS);
    const { agentActionPlans } = await import('../../db/schema/index.js');
    const [plan] = await db.insert(agentActionPlans).values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'evaluating', createdAt: old }).returning();
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId, title: `Recovery Manual ${runId}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId, actionPlanId: plan!.id, updatedAt: old })
      .returning();
    initiativeIds.push(initiative!.id);

    const report = await runRecovery({ dryRun: false, actorUserId: ceoUserId, thresholdSeconds: 60 });
    const item = report.items.find((entry) => entry.entityId === initiative!.id);
    assert.ok(item);
    assert.equal(item!.result, 'manual_attention');

    const [decision] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(and(eq(agentDirectorDecisions.entityId, initiative!.id), eq(agentDirectorDecisions.domain, 'agents')));
    assert.ok(decision, 'deveria existir um Decision Item real e consultável');
    assert.equal(decision!.status, 'open');

    await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, decision!.id));
    const { agentActionPlanItems } = await import('../../db/schema/index.js');
    await db.delete(agentActionPlanItems).where(eq(agentActionPlanItems.planId, plan!.id));
    await db.delete(agentActionPlans).where(eq(agentActionPlans.id, plan!.id));
  });

  test('28: status agregado retorna contagens corretas (staleTotal, byType, oldest)', async () => {
    const review = await insertStaleReview();

    const status = await getRecoveryStatus(60);
    assert.ok(status.staleTotal >= 1);
    assert.ok(status.byType.executive_review >= 1);
    assert.ok(status.oldest);
    assert.ok(status.oldest!.ageSeconds >= 3599);
    void review;
  });

  test('reconcileOne: reconcilia UMA entidade específica sem varrer as demais', async () => {
    const review = await insertStaleReview();

    const result = await reconcileOne({ workflowType: 'executive_review', entityId: review.id, dryRun: false, actorUserId: ceoUserId, thresholdSeconds: 60 });
    assert.ok(result);
    assert.equal(result!.result, 'reverted');

    const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.equal(reloaded, undefined);
  });

  test('reconcileOne: entidade que não está stale devolve null (nada a reconciliar)', async () => {
    const result = await reconcileOne({ workflowType: 'executive_review', entityId: 999999999, dryRun: false, actorUserId: ceoUserId, thresholdSeconds: 60 });
    assert.equal(result, null);
  });
});
