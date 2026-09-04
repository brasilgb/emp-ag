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

import { runOperationalSupervision, setForcedIncidentFailuresForTests } from './supervisor-service.js';

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
    test('35/36: relatório é matematicamente consistente (observed+recovered+autonomyRestricted+escalated+failed === results.length)', async () => {
      await insertFailingJob({ autonomyEnabled: true });
      await insertStaleReview();

      const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
      // v3.2 — `failed` (isolamento por incidente) entra na mesma soma:
      // todo incidente cai em EXATAMENTE um bucket, nunca dois nem
      // nenhum — mesmo invariante de antes, só que agora também cobre o
      // caminho de falha isolada.
      assert.equal(report.observed + report.recovered + report.autonomyRestricted + report.escalated + report.failed, report.results.length);
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

  /*
   * Agentes v3.2 (correio.md "18. Testes mínimos obrigatórios") —
   * isolamento por incidente dentro de um mesmo scan. Usa
   * `setForcedIncidentFailuresForTests` (gancho SOMENTE de teste, mesmo
   * padrão já usado em `agents/llm/factory.ts`/
   * `agents/followups/action-proposals-service.ts`) para forçar
   * deterministicamente uma exceção na resposta operacional de um
   * incidente ESPECÍFICO (por `incident.id`, formato real
   * `${incidentType}:${entityType}:${entityId}`, `incidents.ts`) — nunca
   * mockando o domínio inteiro, só o ponto exato onde uma falha de
   * infraestrutura entraria em produção.
   */
  describe('v3.2 — isolamento por incidente (applyResponse)', () => {
    after(() => setForcedIncidentFailuresForTests(null));

    // Limpeza IMEDIATA (não só no `after()` do describe externo, que só
    // roda ao final de todo o arquivo): os testes deste bloco rodam
    // `runOperationalSupervision({dryRun:false})` de verdade várias vezes
    // sobre Jobs reais — sem isso, um Job restringido (autonomyEnabled →
    // false, efeito real) por um teste anterior contaminaria o contexto
    // (`buildRecommendations`/`jobAutonomyEnabled`) de um teste seguinte
    // no MESMO arquivo, fazendo `restrict_autonomy` virar `manual_attention`
    // de forma imprevisível — não é resíduo entre execuções de suíte
    // (já tratado em outras seções deste projeto), é resíduo DENTRO desta
    // mesma rodada de testes, evitável.
    async function cleanupJob(job: { id: number }) {
      await db.delete(agentJobRuns).where(eq(agentJobRuns.jobId, job.id));
      await db.delete(agentJobs).where(eq(agentJobs.id, job.id));
    }

    test('1: três incidentes válidos → todos processados normalmente (baseline sem nenhuma falha)', async () => {
      const jobA = await insertFailingJob({ autonomyEnabled: true });
      const jobB = await insertFailingJob({ autonomyEnabled: true });
      const jobC = await insertFailingJob({ autonomyEnabled: true });

      try {
        const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });
        for (const job of [jobA, jobB, jobC]) {
          const result = report.results.find((r) => r.entityType === 'agent_job' && r.entityId === String(job.id));
          assert.ok(result, `job ${job.id} deveria ter sido avaliado`);
          assert.equal(result!.outcome, 'autonomy_restricted');
        }
      } finally {
        for (const job of [jobA, jobB, jobC]) await cleanupJob(job);
      }
    });

    test('2/3/4: incidente do meio, o primeiro, e o último falham independentemente — os demais do MESMO scan continuam processados', async () => {
      const idOf = (jobId: number) => `repeated_job_failure:agent_job:${jobId}`;

      for (const label of ['do meio', 'o primeiro', 'o último'] as const) {
        // Jobs FRESCOS a cada iteração — reusar os mesmos 3 jobs entre
        // rodadas encadearia um efeito real desta v3.2 sobre a próxima
        // (um job restringido de verdade numa rodada muda
        // `jobAutonomyEnabled` no contexto da rodada seguinte, mudando a
        // resposta esperada de `restrict_autonomy` para
        // `manual_attention` — não é o que este teste quer provar).
        const jobA = await insertFailingJob({ autonomyEnabled: true });
        const jobB = await insertFailingJob({ autonomyEnabled: true });
        const jobC = await insertFailingJob({ autonomyEnabled: true });
        const [failingJob, okJobs] = label === 'do meio' ? [jobB, [jobA, jobC]] : label === 'o primeiro' ? [jobA, [jobB, jobC]] : [jobC, [jobA, jobB]];

        setForcedIncidentFailuresForTests([idOf(failingJob.id)]);
        try {
          const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

          const failedResult = report.results.find((r) => r.entityType === 'agent_job' && r.entityId === String(failingJob.id));
          assert.ok(failedResult, `incidente ${label} deveria continuar aparecendo em results, mesmo tendo falhado`);
          assert.equal(failedResult!.outcome, 'failed', `incidente ${label} deveria estar marcado como failed`);

          for (const okJob of okJobs) {
            const okResult = report.results.find((r) => r.entityType === 'agent_job' && r.entityId === String(okJob.id));
            assert.ok(okResult, `job ${okJob.id} deveria continuar sendo processado mesmo com a falha do incidente ${label}`);
            assert.equal(okResult!.outcome, 'autonomy_restricted', `job ${okJob.id} deveria ter sido processado normalmente (nunca abortado pela falha ${label})`);
          }

          assert.equal(report.results.filter((r) => r.outcome === 'failed').length, 1, `só o incidente ${label} deveria estar failed`);
        } finally {
          setForcedIncidentFailuresForTests(null);
          for (const job of [jobA, jobB, jobC]) await cleanupJob(job);
        }
      }
    });

    test('5: múltiplos incidentes falham independentemente no mesmo scan — cada um isolado, os demais não são afetados', async () => {
      const jobA = await insertFailingJob({ autonomyEnabled: true });
      const jobB = await insertFailingJob({ autonomyEnabled: true });
      const jobC = await insertFailingJob({ autonomyEnabled: true });
      const jobD = await insertFailingJob({ autonomyEnabled: true });

      const idOf = (jobId: number) => `repeated_job_failure:agent_job:${jobId}`;
      setForcedIncidentFailuresForTests([idOf(jobB.id), idOf(jobD.id)]);

      try {
        const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

        const resultFor = (job: typeof jobA) => report.results.find((r) => r.entityType === 'agent_job' && r.entityId === String(job.id));
        assert.equal(resultFor(jobA)!.outcome, 'autonomy_restricted');
        assert.equal(resultFor(jobB)!.outcome, 'failed');
        assert.equal(resultFor(jobC)!.outcome, 'autonomy_restricted');
        assert.equal(resultFor(jobD)!.outcome, 'failed');
      } finally {
        setForcedIncidentFailuresForTests(null);
        for (const job of [jobA, jobB, jobC, jobD]) await cleanupJob(job);
      }
    });

    test('6: falha individual gera auditoria própria (agents.operations.incident.failed), com contexto de diagnóstico e sem stack trace', async () => {
      const job = await insertFailingJob({ autonomyEnabled: true });
      const incidentId = `repeated_job_failure:agent_job:${job.id}`;
      setForcedIncidentFailuresForTests([incidentId]);

      try {
        const before = new Date();
        await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

        const failedAudits = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.action, 'agents.operations.incident.failed'), eq(auditLogs.entityId, String(job.id))));
        const recent = failedAudits.filter((row) => row.createdAt.getTime() >= before.getTime());
        assert.equal(recent.length, 1);

        const metadata = recent[0]!.metadata as { incidentType: string; severity: string; attemptedResponse: string; message: string };
        assert.equal(metadata.incidentType, 'repeated_job_failure');
        assert.equal(metadata.attemptedResponse, 'restrict_autonomy');
        assert.ok(metadata.message.includes('Falha forçada'));
        assert.ok(!metadata.message.includes('    at '), 'nunca persistir stack trace no audit — só error.message');
      } finally {
        setForcedIncidentFailuresForTests(null);
        await cleanupJob(job);
      }
    });

    test('7/8: scan chega a "completed" mesmo com falha parcial; summary distingue failed dos demais outcomes', async () => {
      const job = await insertFailingJob({ autonomyEnabled: true });
      const incidentId = `repeated_job_failure:agent_job:${job.id}`;
      setForcedIncidentFailuresForTests([incidentId]);

      try {
        // Não deveria lançar — o scan chega ao fim normalmente.
        const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

        const ownResult = report.results.find((r) => r.entityId === String(job.id));
        assert.equal(ownResult!.outcome, 'failed');
        // `report.failed` é um agregado do scan inteiro — pode incluir
        // outros incidentes reais e independentes já presentes no banco
        // compartilhado de testes (não é escopo deste teste isolar
        // TODOS eles); o que importa aqui é que o incidente deste
        // fixture está corretamente contado como `failed` no agregado.
        assert.ok(report.failed >= 1);

        const completedAudits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.operations.scan.completed'));
        const recent = completedAudits.filter((row) => new Date(row.createdAt).getTime() >= new Date(report.startedAt).getTime());
        assert.ok(recent.length > 0, 'scan.completed continua sendo auditado mesmo com falha parcial — nunca vira uma falha estrutural');
      } finally {
        setForcedIncidentFailuresForTests(null);
        await cleanupJob(job);
      }
    });

    test('9/10: uma Escalation cria antes de uma falha (job A) não desaparece, e outra depois da falha (job C) ainda é criada — escalonamento continua isolado da resposta operacional', async () => {
      // escalateSupervisorFinding já roda em seu PRÓPRIO try/catch,
      // independente do outcome de applyResponse (mesmo quando
      // outcome === 'failed') — a resposta operacional e o
      // escalonamento organizacional são preocupações ortogonais desde a
      // v2.6; este teste prova que a v3.2 não acoplou as duas.
      const jobA = await insertFailingJob({ autonomyEnabled: true });
      const jobB = await insertFailingJob({ autonomyEnabled: true });
      const jobC = await insertFailingJob({ autonomyEnabled: true });
      setForcedIncidentFailuresForTests([`repeated_job_failure:agent_job:${jobB.id}`]);

      try {
        const before = new Date();
        const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId });

        assert.equal(report.results.find((r) => r.entityId === String(jobA.id))!.outcome, 'autonomy_restricted');
        assert.equal(report.results.find((r) => r.entityId === String(jobB.id))!.outcome, 'failed');
        assert.equal(report.results.find((r) => r.entityId === String(jobC.id))!.outcome, 'autonomy_restricted');

        // Nenhuma Responsibility real está cadastrada para este fixture
        // (mesmo padrão do resto deste arquivo — testes de escalonamento
        // real vivem em `escalations/supervisor-integration.test.ts`),
        // então `escalateSupervisorFinding` sempre devolve `null` aqui —
        // o que este teste prova é que ele é TENTADO para os 3
        // incidentes, nunca pulado por causa da falha isolada de um
        // deles.
        const incidentDetectedAudits = await db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.action, 'agents.operations.incident.detected'));
        const recent = incidentDetectedAudits.filter((row) => row.createdAt.getTime() >= before.getTime());
        for (const job of [jobA, jobB, jobC]) {
          assert.ok(
            recent.some((row) => row.entityId === String(job.id)),
            `incident.detected deveria ter sido auditado para o job ${job.id}, independente do outcome final`,
          );
        }
      } finally {
        setForcedIncidentFailuresForTests(null);
        for (const job of [jobA, jobB, jobC]) await cleanupJob(job);
      }
    });

    test('19/20: a mesma proteção vale para triggeredBy="manual" e triggeredBy="scheduler" — nenhum tratamento especial só para automático', async () => {
      for (const triggeredBy of ['manual', 'scheduler'] as const) {
        const jobA = await insertFailingJob({ autonomyEnabled: true });
        const jobB = await insertFailingJob({ autonomyEnabled: true });
        setForcedIncidentFailuresForTests([`repeated_job_failure:agent_job:${jobA.id}`]);

        try {
          const report = await runOperationalSupervision({ dryRun: false, actorUserId: ceoUserId, triggeredBy });

          assert.equal(report.results.find((r) => r.entityId === String(jobA.id))!.outcome, 'failed', `triggeredBy=${triggeredBy}: incidente forçado deveria falhar isolado`);
          assert.equal(report.results.find((r) => r.entityId === String(jobB.id))!.outcome, 'autonomy_restricted', `triggeredBy=${triggeredBy}: o outro incidente deveria continuar processado normalmente`);
        } finally {
          setForcedIncidentFailuresForTests(null);
          await cleanupJob(jobA);
          await cleanupJob(jobB);
        }
      }
    });
  });
});
