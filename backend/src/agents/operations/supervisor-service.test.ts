import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlanItems,
  agentApprovals,
  agentDirectorDecisions,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutiveReviews,
  agentJobRuns,
  agentJobs,
  agents,
  auditLogs,
  permissions,
  rolePermissions,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { runOperationalSupervision } from './supervisor-service.js';

const HOUR_MS = 60 * 60 * 1000;

/*
 * Agentes v2.5 (correio.md seção 28) — execução/segurança/idempotência/
 * concorrência do Supervisor.
 */
describe('Agentes v2.5 - runOperationalSupervision (execução)', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let directorAgentId: number;
  const jobIds: number[] = [];
  const runIds: number[] = [];
  const goalIds: number[] = [];
  const initiativeIds: number[] = [];
  const reviewIds: number[] = [];
  const decisionIds: number[] = [];

  async function insertFailingJob(overrides: Partial<typeof agentJobs.$inferInsert> = {}) {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Supervisor Job ${runId}-${Math.random()}`,
        objective: 'objetivo de teste',
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'internal_event',
        autonomyEnabled: true,
        ...overrides,
      })
      .returning();
    jobIds.push(job!.id);

    for (let index = 0; index < 5; index += 1) {
      const [run] = await db.insert(agentJobRuns).values({ jobId: job!.id, triggerType: 'internal_event', status: 'failed', startedAt: new Date() }).returning();
      runIds.push(run!.id);
    }

    return job!;
  }

  async function insertStaleReview() {
    const { agentActionPlans } = await import('../../db/schema/index.js');
    const [plan] = await db.insert(agentActionPlans).values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'completed' }).returning();
    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({ title: `Goal Supervisor ${runId}-${Math.random()}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', createdBy: ceoUserId, startDate: new Date('2026-01-01T00:00:00.000Z'), targetDate: new Date('2026-12-01T00:00:00.000Z'), targetType: 'milestone' })
      .returning();
    goalIds.push(goal!.id);
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId: goal!.id, title: `Initiative Supervisor ${runId}`, description: 'd', domain: 'crm', status: 'completed', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId, actionPlanId: plan!.id })
      .returning();
    initiativeIds.push(initiative!.id);

    const old = new Date(Date.now() - HOUR_MS);
    const [review] = await db
      .insert(agentExecutiveReviews)
      .values({ goalId: goal!.id, initiativeId: initiative!.id, actionPlanId: plan!.id, createdBy: ceoUserId, reviewType: 'initiative_outcome', status: 'draft', evidence: {}, updatedAt: old })
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

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;
  });

  after(async () => {
    for (const id of decisionIds) await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, id));
    for (const id of reviewIds) await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, id));
    for (const id of initiativeIds) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    for (const id of goalIds) await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, id));
    for (const id of runIds) await db.delete(agentJobRuns).where(eq(agentJobRuns.id, id));
    for (const id of jobIds) await db.delete(agentJobs).where(eq(agentJobs.id, id));

    await database.end();
    redis.disconnect();
  });

  test('23: safe_recovery chama Recovery v2.4 de verdade (review draft stale → reverted)', async () => {
    const review = await insertStaleReview();

    const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
    const result = report.results.find((item) => item.entityType === 'executive_review' && item.entityId === String(review.id));
    assert.ok(result);
    assert.equal(result!.response, 'safe_recovery');
    assert.equal(result!.outcome, 'recovered');

    const [reloaded] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.equal(reloaded, undefined, 'a linha draft órfã deveria ter sido removida pelo Recovery v2.4 real');
  });

  test('13/25: repeated_job_failure crítico com autonomia ligada → restrict_autonomy real (mecanismo oficial da v1.5)', async () => {
    const job = await insertFailingJob({ autonomyEnabled: true });

    const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
    const result = report.results.find((item) => item.entityType === 'agent_job' && item.entityId === String(job.id) && item.response === 'restrict_autonomy');
    assert.ok(result);
    assert.equal(result!.outcome, 'autonomy_restricted');

    const [reloaded] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
    assert.equal(reloaded!.autonomyEnabled, false);
  });

  test('14/24: repeated_job_failure crítico com autonomia JÁ restrita → manual_attention (Decision Queue real)', async () => {
    const job = await insertFailingJob({ autonomyEnabled: false });

    const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
    const result = report.results.find((item) => item.entityType === 'agent_job' && item.entityId === String(job.id) && item.response === 'manual_attention');
    assert.ok(result);
    assert.equal(result!.outcome, 'escalated');

    const [decision] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(and(eq(agentDirectorDecisions.entityId, job.id), eq(agentDirectorDecisions.domain, 'agents')));
    assert.ok(decision, 'deveria existir um Decision Item real');
    assert.equal(decision!.status, 'open');
    decisionIds.push(decision!.id);
  });

  test('21/22: dry-run sem side effects, informa "would_*"', async () => {
    const job = await insertFailingJob({ autonomyEnabled: true });
    const review = await insertStaleReview();

    const report = await runOperationalSupervision({ dryRun: true, actorUserId: ceoUserId });
    assert.equal(report.dryRun, true);

    const jobResult = report.results.find((item) => item.entityType === 'agent_job' && item.entityId === String(job.id));
    assert.ok(jobResult);
    assert.equal(jobResult!.outcome, 'would_restrict_autonomy');

    const reviewResult = report.results.find((item) => item.entityType === 'executive_review' && item.entityId === String(review.id));
    assert.ok(reviewResult);
    assert.equal(reviewResult!.outcome, 'would_recover');

    const [reloadedJob] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
    assert.equal(reloadedJob!.autonomyEnabled, true, 'dry-run nunca altera o banco');

    const [reloadedReview] = await db.select().from(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, review.id));
    assert.ok(reloadedReview, 'dry-run nunca remove a linha draft');
  });

  test('26/27/28: idempotência — segundo scan não duplica Decision Item nem repete recovery/restrição já realizados', async () => {
    const job = await insertFailingJob({ autonomyEnabled: true });

    const first = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
    const firstResult = first.results.find((item) => item.entityType === 'agent_job' && item.entityId === String(job.id));
    assert.equal(firstResult!.outcome, 'autonomy_restricted');

    const second = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
    const secondResult = second.results.find((item) => item.entityType === 'agent_job' && item.entityId === String(job.id));
    assert.ok(secondResult);
    // Job já está com autonomia restrita — a policy agora recomenda
    // manual_attention (autonomia já off + falhas continuam) — nunca
    // "autonomy_restricted" de novo.
    assert.notEqual(secondResult!.outcome, 'autonomy_restricted', 'nunca repete a restrição de autonomia sobre o mesmo Job');

    if (secondResult!.response === 'manual_attention') {
      const decisions = await db
        .select()
        .from(agentDirectorDecisions)
        .where(and(eq(agentDirectorDecisions.entityId, job.id), eq(agentDirectorDecisions.domain, 'agents')));
      assert.ok(decisions.length <= 1, 'nunca mais de um Decision Item para o mesmo incidente');
      for (const decision of decisions) decisionIds.push(decision.id);

      // Terceiro scan — mesma condição, mesmo Decision Item (dedup).
      await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
      const decisionsAfterThird = await db
        .select()
        .from(agentDirectorDecisions)
        .where(and(eq(agentDirectorDecisions.entityId, job.id), eq(agentDirectorDecisions.domain, 'agents')));
      assert.equal(decisionsAfterThird.length, decisions.length, 'terceiro scan não duplica o Decision Item');
    }
  });

  test('29: dois supervisors concorrentes sobre o MESMO Job produzem só UMA restrição real (nunca dois efeitos incompatíveis)', async () => {
    const job = await insertFailingJob({ autonomyEnabled: true });

    await Promise.all([
      runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId }),
      runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId }),
    ]);

    const [reloaded] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
    assert.equal(reloaded!.autonomyEnabled, false);

    const restrictedAudits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'agent_autonomy.job_disabled'), eq(auditLogs.entityId, String(job.id))));
    // triggeredBy=operational_supervisor deveria aparecer só uma vez —
    // predicado condicional (WHERE autonomy_enabled=true) garante isso.
    const supervisorAudits = restrictedAudits.filter((row) => (row.metadata as { triggeredBy?: string } | null)?.triggeredBy === 'operational_supervisor');
    assert.equal(supervisorAudits.length, 1, 'só uma das duas chamadas concorrentes deveria ter efetivamente restringido a autonomia');
  });

  describe('Segurança (itens 15-20)', () => {
    test('15/16/17: supervisor nunca cria Action Plan, nunca cria approval, nunca chama ferramenta arbitrária', async () => {
      const job = await insertFailingJob({ autonomyEnabled: true });
      const review = await insertStaleReview();

      const approvalsBefore = await db.select().from(agentApprovals);
      const itemsBefore = await db.select().from(agentActionPlanItems);

      await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

      const approvalsAfter = await db.select().from(agentApprovals);
      const itemsAfter = await db.select().from(agentActionPlanItems);

      assert.equal(approvalsAfter.length, approvalsBefore.length, 'nunca cria approval');
      assert.equal(itemsAfter.length, itemsBefore.length, 'nunca cria Action Plan Item (nunca executa tool)');
      void job;
      void review;
    });

    test('18: supervisor nunca modifica permissions/role_permissions', async () => {
      const permsBefore = await db.select().from(permissions);
      const rolePermsBefore = await db.select().from(rolePermissions);

      const job = await insertFailingJob({ autonomyEnabled: true });
      await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

      const permsAfter = await db.select().from(permissions);
      const rolePermsAfter = await db.select().from(rolePermissions);

      assert.equal(permsAfter.length, permsBefore.length);
      assert.equal(rolePermsAfter.length, rolePermsBefore.length);
      void job;
    });

    test('19: supervisor nunca aumenta autonomia (Job já restrito continua restrito após novo scan)', async () => {
      const job = await insertFailingJob({ autonomyEnabled: false });
      await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

      const [reloaded] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
      assert.equal(reloaded!.autonomyEnabled, false, 'nunca reativa autonomia sozinho');
    });

    test('20: supervisor nunca remove/altera bloqueio de Circuit Breaker (circuit_state nunca é escrito por este módulo)', async () => {
      const job = await insertFailingJob({ autonomyEnabled: true, circuitState: 'open', circuitOpenedAt: new Date(), circuitFailureCount: 5 });

      await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

      const [reloaded] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
      assert.equal(reloaded!.circuitState, 'open', 'circuit_state nunca é alterado pelo supervisor — resposta foi already_handled');
    });
  });

  describe('Status agregado (itens 35-37)', () => {
    test('35/36: relatório é matematicamente consistente (observed+recovered+autonomyRestricted+escalated === results.length)', async () => {
      await insertFailingJob({ autonomyEnabled: true });
      await insertStaleReview();

      const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
      assert.equal(report.observed + report.recovered + report.autonomyRestricted + report.escalated, report.results.length);
      assert.equal(report.incidentsDetected, report.results.length);
    });

    test('37: scan.completed é auditado com signalsDetected/incidentsDetected corretos', async () => {
      await insertFailingJob({ autonomyEnabled: true });
      const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

      const allScanCompletedAudits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.operations.scan.completed'));
      const recentAudits = allScanCompletedAudits.filter((row) => row.createdAt.getTime() >= new Date(report.startedAt).getTime());
      assert.ok(recentAudits.length > 0);
      const metadata = recentAudits[recentAudits.length - 1]!.metadata as { signalsDetected: number; incidentsDetected: number };
      assert.equal(metadata.incidentsDetected, report.incidentsDetected);
    });
  });
});
