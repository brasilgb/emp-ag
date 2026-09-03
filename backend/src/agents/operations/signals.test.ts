import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  agentApprovals,
  agentDirectorDecisions,
  agentDirectorGoals,
  agentDirectorInitiatives,
  agentExecutions,
  agentJobRuns,
  agentJobs,
  agents,
  agentTools,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { env } from '../../config/env.js';

import { collectOperationalSignals } from './signals.js';
import { classifyIncidents } from './incidents.js';

const HOUR_MS = 60 * 60 * 1000;

/*
 * Agentes v2.5 (correio.md seção 28, "Signal detection") — cada
 * detector, direto contra fixtures reais no banco. Reaproveita as MESMAS
 * fontes já testadas em outros módulos (Recovery v2.4, Incident Center
 * v1.6) — aqui só prova que `collectOperationalSignals` as agrega
 * corretamente.
 */
describe('Agentes v2.5 - collectOperationalSignals (Signal Detection)', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let directorAgentId: number;
  const jobIds: number[] = [];
  const runIds: number[] = [];
  const goalIds: number[] = [];
  const initiativeIds: number[] = [];
  const decisionIds: number[] = [];
  const approvalIds: number[] = [];
  const executionIds: number[] = [];

  async function insertJob(overrides: Partial<typeof agentJobs.$inferInsert> = {}) {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Signal Job ${runId}-${Math.random()}`,
        objective: 'objetivo de teste',
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'internal_event',
        ...overrides,
      })
      .returning();
    jobIds.push(job!.id);
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
    for (const id of approvalIds) await db.delete(agentApprovals).where(eq(agentApprovals.id, id));
    for (const id of executionIds) await db.delete(agentExecutions).where(eq(agentExecutions.id, id));
    for (const id of decisionIds) await db.delete(agentDirectorDecisions).where(eq(agentDirectorDecisions.id, id));
    for (const id of initiativeIds) await db.delete(agentDirectorInitiatives).where(eq(agentDirectorInitiatives.id, id));
    for (const id of goalIds) await db.delete(agentDirectorGoals).where(eq(agentDirectorGoals.id, id));
    for (const id of runIds) await db.delete(agentJobRuns).where(eq(agentJobRuns.id, id));
    for (const id of jobIds) await db.delete(agentJobs).where(eq(agentJobs.id, id));

    await database.end();
    redis.disconnect();
  });

  test('1: estado saudável (Job sem falhas) não gera signal para esse Job', async () => {
    const job = await insertJob();
    const signals = await collectOperationalSignals();
    assert.ok(!signals.some((signal) => signal.entityId === String(job.id) && signal.type === 'job_repeated_failure'));
  });

  test('4: falhas consecutivas atingindo o threshold do Circuit Breaker geram signal job_repeated_failure', async () => {
    const job = await insertJob();
    const threshold = 5; // AGENT_AUTONOMY_CIRCUIT_FAILURE_THRESHOLD default
    for (let index = 0; index < threshold; index += 1) {
      const [run] = await db.insert(agentJobRuns).values({ jobId: job.id, triggerType: 'internal_event', status: 'failed', startedAt: new Date() }).returning();
      runIds.push(run!.id);
    }

    const signals = await collectOperationalSignals();
    assert.ok(signals.some((signal) => signal.type === 'job_repeated_failure' && signal.entityId === String(job.id)));
  });

  test('3: falha isolada (1 run falho, abaixo do threshold) não gera job_repeated_failure', async () => {
    const job = await insertJob();
    const [run] = await db.insert(agentJobRuns).values({ jobId: job.id, triggerType: 'internal_event', status: 'failed', startedAt: new Date() }).returning();
    runIds.push(run!.id);

    const signals = await collectOperationalSignals();
    assert.ok(!signals.some((signal) => signal.type === 'job_repeated_failure' && signal.entityId === String(job.id)));
  });

  test('run_stuck: Run "running" antigo gera signal, Run recente não', async () => {
    const job = await insertJob();
    const old = new Date(Date.now() - HOUR_MS);
    const [stuckRun] = await db.insert(agentJobRuns).values({ jobId: job.id, triggerType: 'internal_event', status: 'running', startedAt: old, createdAt: old }).returning();
    runIds.push(stuckRun!.id);
    const [recentRun] = await db.insert(agentJobRuns).values({ jobId: job.id, triggerType: 'internal_event', status: 'running', startedAt: new Date() }).returning();
    runIds.push(recentRun!.id);

    const signals = await collectOperationalSignals();
    assert.ok(signals.some((signal) => signal.type === 'run_stuck' && signal.entityId === String(stuckRun!.id)));
    assert.ok(!signals.some((signal) => signal.type === 'run_stuck' && signal.entityId === String(recentRun!.id)));
  });

  test('5: condição de autonomia restrita (circuito aberto) aparece no health/signals', async () => {
    const job = await insertJob({ circuitState: 'open', circuitOpenedAt: new Date(), circuitFailureCount: 5 });

    const signals = await collectOperationalSignals();
    assert.ok(signals.some((signal) => signal.type === 'autonomy_circuit_open' && signal.entityId === String(job.id)));
  });

  test('2: workflow stale (Recovery v2.4) gera signal workflow_stale', async () => {
    const [goal] = await db
      .insert(agentDirectorGoals)
      .values({ title: `Goal Signals ${runId}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', createdBy: ceoUserId, startDate: new Date('2026-01-01T00:00:00.000Z'), targetDate: new Date('2026-12-01T00:00:00.000Z'), targetType: 'milestone' })
      .returning();
    goalIds.push(goal!.id);

    const old = new Date(Date.now() - HOUR_MS);
    const [initiative] = await db
      .insert(agentDirectorInitiatives)
      .values({ goalId: goal!.id, title: `Initiative Signals ${runId}`, description: 'd', domain: 'crm', status: 'active', priority: 'medium', rationale: 'r', origin: 'manual', createdBy: ceoUserId, actionPlanId: null, updatedAt: old })
      .returning();
    initiativeIds.push(initiative!.id);

    const signals = await collectOperationalSignals();
    assert.ok(signals.some((signal) => signal.type === 'workflow_stale' && signal.entityId === String(initiative!.id)));
  });

  test('6: Decision Queue com requiresHumanAttention aparece nos signals (manual_attention_pending)', async () => {
    const [decision] = await db
      .insert(agentDirectorDecisions)
      .values({
        deduplicationKey: `test.signal.decision::${runId}::${Math.random()}`,
        signalType: 'test.signal',
        domain: 'agents',
        title: 'Decision de teste',
        description: 'd',
        severity: 'critical',
        impact: 'high',
        urgency: 'immediate',
        priorityScore: 100,
        priorityFactors: {},
        status: 'open',
        requiresHumanAttention: true,
        firstDetectedAt: new Date(),
        lastDetectedAt: new Date(),
        occurrenceCount: 1,
      })
      .returning();
    decisionIds.push(decision!.id);

    const signals = await collectOperationalSignals();
    assert.ok(signals.some((signal) => signal.type === 'manual_attention_pending' && signal.entityId === String(decision!.id)));

    const incidents = classifyIncidents(signals);
    assert.ok(incidents.some((incident) => incident.type === 'manual_attention_required' && incident.entityId === String(decision!.id)));
  });

  test('approval_bottleneck: approval pendente antiga gera signal agregado', async () => {
    const oldApprovalBefore = new Date(Date.now() - env.AGENT_OPERATIONAL_APPROVAL_WARNING_AFTER_SECONDS * 1000 - 60000);

    const [tool] = await db.select().from(agentTools).where(eq(agentTools.handler, 'director.get_business_overview')).limit(1);
    assert.ok(tool, 'tool director.get_business_overview deveria existir no seed');

    const [execution] = await db
      .insert(agentExecutions)
      .values({ agentId: directorAgentId, userId: ceoUserId, toolId: tool!.id, autonomyLevel: 'approval_required', status: 'waiting_approval' })
      .returning();

    const [approval] = await db
      .insert(agentApprovals)
      .values({ executionId: execution!.id, status: 'pending', createdAt: oldApprovalBefore })
      .returning();
    approvalIds.push(approval!.id);
    executionIds.push(execution!.id);

    const signals = await collectOperationalSignals();
    const bottleneck = signals.find((signal) => signal.type === 'approval_bottleneck');
    assert.ok(bottleneck, 'deveria existir sinal de approval_bottleneck com pelo menos essa approval pendente antiga');
    assert.ok((bottleneck!.metadata?.count as number) >= 1);
  });
});
