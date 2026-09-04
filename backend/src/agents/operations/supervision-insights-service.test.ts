import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentActionPlans,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutiveReviews,
  agentJobRuns,
  agentJobs,
  agentOperationalEscalations,
  agentOperationalFollowUps,
  agentResponsibilities,
  agents,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { runObservedOperationalSupervision } from './supervision-run-history.js';
import { getSupervisionIncidentDetail, getSupervisionOverview, listRecurringIncidents, listSupervisionIncidents } from './supervision-insights-service.js';

const HOUR_MS = 60 * 60 * 1000;

/*
 * Agentes v3.5 (correio.md "Operational Supervision Insights & Incident
 * Review", "8. Testes obrigatórios") — roda contra o Postgres de teste
 * real, incidentes REAIS produzidos por `runOperationalSupervision`
 * (mesma técnica de supervisor-service.test.ts/supervisor-integration.test.ts)
 * — nenhum mock do supervisor em si, só fixtures que fazem os detectores
 * reais dispararem de forma determinística.
 */
describe('Agentes v3.5 - supervision-insights-service (overview, histórico, detalhe, recorrência)', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let directorAgentId: number;

  const jobIds: number[] = [];
  const runIds: number[] = [];
  const goalIds: number[] = [];
  const initiativeIds: number[] = [];
  const reviewIds: number[] = [];
  const responsibilityIds: number[] = [];
  const planIds: number[] = [];

  async function insertFailingJob() {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Insights Job ${runId}-${Math.random()}`,
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

  async function insertStaleReview() {
    const [plan] = await db.insert(agentActionPlans).values({ requestedBy: ceoUserId, objective: 'obj', summary: 'sum', status: 'completed' }).returning();
    planIds.push(plan!.id);
    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({ title: `Goal Insights ${runId}-${Math.random()}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', createdBy: ceoUserId, startDate: new Date('2026-01-01T00:00:00.000Z'), targetDate: new Date('2026-12-01T00:00:00.000Z'), targetType: 'milestone' })
      .returning();
    goalIds.push(goal!.id);
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId: goal!.id, title: `Initiative Insights ${runId}`, description: 'd', domain: 'crm', status: 'completed', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId, actionPlanId: plan!.id })
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

    // Garante uma escalation real e determinística para o teste de
    // vínculo run → incident → response → escalation: Job pertence ao
    // agente 'director' → domínio resolvido é sempre 'agents'
    // (escalations/supervisor-integration.ts, DEPARTMENT_TO_DOMAIN).
    const [responsibility] = await db
      .insert(agentResponsibilities)
      .values({ agentId: directorAgentId, name: `Escala Insights ${runId}`, domain: 'agents', responsibilityType: 'monitor', priority: 'critical', escalationPolicy: 'agent', escalationTargetAgentId: directorAgentId, createdBy: ceoUserId })
      .returning();
    responsibilityIds.push(responsibility!.id);
  });

  after(async () => {
    // Escalations reais criadas por `escalateSupervisorFinding` durante o
    // teste referenciam `responsibilityId` com `onDelete: 'restrict'`
    // (agent-operational-escalations.ts) — precisam ser removidas ANTES
    // da Responsibility. E `escalateSupervisorFinding` sempre tenta criar/
    // reabrir um FollowUp a partir da Escalation (v2.7,
    // createOrReopenFollowUpFromEscalation) — `agent_operational_follow_ups`
    // tem `onDelete: 'restrict'` tanto para `escalation_id` QUANTO para
    // `responsibility_id` diretamente (schema revisado nesta rodada),
    // então o FollowUp precisa ser removido ANTES de ambos. Ordem
    // completa: FollowUp (por responsibilityId, cobre tudo de uma vez) →
    // Escalation → Responsibility (mesmo padrão de
    // control-center-service.test.ts). Bug real encontrado nesta rodada:
    // a versão anterior deste `after()` pulava o FollowUp inteiramente e
    // deixava a Responsibility (e sua Escalation/FollowUp) órfã no banco
    // real toda vez que o teste rodava — poluição que chegou a derrubar
    // outros testes deste projeto (control-center-service.test.ts,
    // review-service.test.ts) ao interferir na resolução de
    // `resolvePrimaryResponsibility({domain:'agents'})`.
    for (const id of responsibilityIds) {
      await db.delete(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.responsibilityId, id));
      await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.responsibilityId, id));
    }
    for (const id of responsibilityIds) await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, id));
    for (const id of reviewIds) await db.delete(agentExecutiveReviews).where(eq(agentExecutiveReviews.id, id));
    for (const id of initiativeIds) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    for (const id of goalIds) await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, id));
    for (const id of planIds) await db.delete(agentActionPlans).where(eq(agentActionPlans.id, id));
    for (const id of runIds) await db.delete(agentJobRuns).where(eq(agentJobRuns.id, id));
    for (const id of jobIds) await db.delete(agentJobs).where(eq(agentJobs.id, id));

    await database.end();
    redis.disconnect();
  });

  test('overview/histórico/detalhe/recorrência: run real com 2 incidentes distintos (recovery_required→recovered, repeated_job_failure→autonomy_restricted+escalated)', async () => {
    const review = await insertStaleReview();
    const job = await insertFailingJob();

    const report = await runObservedOperationalSupervision({ dryRun: false, actorUserId: ceoUserId, triggeredBy: 'manual' });
    assert.equal(report.failed, 0, 'nenhuma falha estrutural esperada nesta fixture');

    const recoveryResult = report.results.find((r) => r.entityType === 'executive_review' && r.entityId === String(review.id));
    assert.ok(recoveryResult, 'incidente recovery_required deveria ter sido detectado para a review stale');
    assert.equal(recoveryResult!.outcome, 'recovered');

    const jobResult = report.results.find((r) => r.entityType === 'agent_job' && r.entityId === String(job.id));
    assert.ok(jobResult, 'incidente repeated_job_failure deveria ter sido detectado para o job com 5 falhas');
    assert.equal(jobResult!.outcome, 'autonomy_restricted');

    // --- Overview (seção 1) ---
    const overview = await getSupervisionOverview();
    assert.ok(overview.totalIncidentsDetected >= 2, 'overview deveria contar ao menos os 2 incidentes reais desta fixture');
    assert.ok(overview.incidentsBySeverity.critical >= 1, 'o job com falhas repetidas deveria contar como severidade crítica');
    assert.ok(overview.responsesApplied.recovered >= 1);
    assert.ok(overview.responsesApplied.autonomyRestricted >= 1);
    assert.ok(overview.escalationsCreated >= 1, 'o incidente do job deveria ter gerado ao menos uma escalation real (Responsibility configurada no before())');

    // --- Histórico pesquisável (seção 2) ---
    const bySeverity = await listSupervisionIncidents({ page: 1, limit: 50, severity: 'critical' });
    assert.ok(bySeverity.rows.some((row) => row.entityType === 'agent_job' && row.entityId === String(job.id)));
    assert.ok(bySeverity.rows.every((row) => row.severity === 'critical'), 'filtro de severidade deveria excluir tudo que não é critical');

    const byType = await listSupervisionIncidents({ page: 1, limit: 50, incidentType: 'recovery_required' });
    assert.ok(byType.rows.some((row) => row.entityType === 'executive_review' && row.entityId === String(review.id)));
    assert.ok(byType.rows.every((row) => row.incidentType === 'recovery_required'));

    const byResponse = await listSupervisionIncidents({ page: 1, limit: 50, response: 'restrict_autonomy' });
    assert.ok(byResponse.rows.some((row) => row.entityType === 'agent_job' && row.entityId === String(job.id)));

    const byEscalation = await listSupervisionIncidents({ page: 1, limit: 50, hasEscalation: true });
    const jobRowWithEscalation = byEscalation.rows.find((row) => row.entityType === 'agent_job' && row.entityId === String(job.id));
    assert.ok(jobRowWithEscalation, 'filtro hasEscalation=true deveria incluir o incidente do job (tem escalation real)');
    assert.equal(jobRowWithEscalation!.outcome, 'autonomy_restricted');
    assert.ok(jobRowWithEscalation!.runId !== null, 'vínculo incident → run deveria estar preenchido (advisory lock garante correlação inequívoca — v3.4 + v3.5 nunca divergem)');
    assert.equal(jobRowWithEscalation!.runStatus, 'succeeded', 'regressão v3.4: o run que produziu este incidente deveria estar corretamente correlacionado e com o status real gravado pelo histórico da v3.4');

    const byEntity = await listSupervisionIncidents({ page: 1, limit: 50, entityType: 'agent_job', entityId: String(job.id) });
    assert.equal(byEntity.rows.length, 1);
    assert.equal(byEntity.rows[0]!.entityId, String(job.id));

    // --- Incident Review (seção 3) ---
    const detail = await getSupervisionIncidentDetail(jobRowWithEscalation!.auditLogId);
    assert.ok(detail);
    assert.equal(detail!.incidentType, 'repeated_job_failure');
    assert.equal(detail!.entityType, 'agent_job');
    assert.equal(detail!.entityId, String(job.id));
    assert.equal(detail!.outcome, 'autonomy_restricted');
    assert.ok(detail!.escalation, 'detalhe deveria trazer a escalation vinculada');
    assert.equal(detail!.escalation!.status, 'open');
    assert.ok(detail!.auditRefs.length > 0, 'deveria haver ao menos o audit de autonomy_restricted como referência');
    assert.ok(detail!.problem.length > 0);

    // Confirma a escalation real no banco bate com o incidentId esperado.
    const [escalationRow] = await db.select().from(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, detail!.escalation!.id));
    assert.equal((escalationRow!.metadata as { incidentId?: string }).incidentId, `repeated_job_failure:agent_job:${job.id}`);

    // --- Ausência de dados sensíveis (seção 7/8) ---
    const serialized = JSON.stringify(detail);
    for (const forbidden of ['password', 'passwordHash', 'token', 'secret', 'apiKey', ' at ']) {
      assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `detalhe do incidente nunca deveria conter "${forbidden}"`);
    }

    // --- Recorrência (seção 4): reprocessar o MESMO job (ainda com autonomia
    // restrita e falhas contínuas) produz um segundo incidente com o MESMO
    // incidentId — recorrência deve capturar isso.
    const secondReport = await runObservedOperationalSupervision({ dryRun: false, actorUserId: ceoUserId, triggeredBy: 'manual' });
    assert.equal(secondReport.failed, 0);

    const recurring = await listRecurringIncidents();
    const recurringJob = recurring.find((row) => row.entityType === 'agent_job' && row.entityId === String(job.id));
    assert.ok(recurringJob, 'o job deveria aparecer como incidente recorrente após 2 scans consecutivos sem resolução');
    assert.ok(recurringJob!.occurrences >= 2);
    assert.ok(new Date(recurringJob!.lastSeenAt).getTime() >= new Date(recurringJob!.firstSeenAt).getTime());
  });

  test('histórico vazio: filtros que não batem com nada devolvem listas vazias, nunca erro', async () => {
    const farFuture = new Date('2999-01-01T00:00:00.000Z');
    const { rows, total } = await listSupervisionIncidents({ page: 1, limit: 20, dateFrom: farFuture });
    assert.deepEqual(rows, []);
    assert.equal(total, 0);

    const overview = await getSupervisionOverview({ dateFrom: farFuture });
    assert.equal(overview.totalIncidentsDetected, 0);
    assert.equal(overview.escalationsCreated, 0);
    assert.deepEqual(overview.responsesApplied, { observed: 0, recovered: 0, autonomyRestricted: 0, escalated: 0, failed: 0 });

    const recurring = await listRecurringIncidents({ dateFrom: farFuture });
    assert.deepEqual(recurring, []);

    const detail = await getSupervisionIncidentDetail(999999999);
    assert.equal(detail, null);
  });
});
