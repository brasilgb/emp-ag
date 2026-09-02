import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentEvents, agentJobs, agents, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { runAgentJob } from '../../agents/jobs/job-runner.js';

/*
 * Agentes v1.6 (correio.md seções 4/5) — Execution Timeline / Chain View.
 * Testa GET /agents/job-runs/:id/detail (novo) e GET
 * /agents/job-runs/:id/lineage (já existente desde a v1.5, sem teste
 * HTTP dedicado até agora). Mesma técnica de fixture de
 * agents/jobs/job-runner.autonomy.test.ts: fabrica um agent_events
 * "causador" com lineage já preenchida em vez de exigir LLM real.
 */
describe('Agentes v1.6 — Execution Timeline / Chain View (job-runs detail/lineage)', () => {
  const app = buildApp();
  const runId = Date.now();

  let ceoToken: string;
  let ceoUserId: number;
  let directorAgentId: number;

  const createdJobIds: number[] = [];
  const createdEventIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createJob() {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Job detail ${runId}-${Math.random().toString(36).slice(2, 8)}`,
        objective: 'Objetivo de teste',
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'internal_event',
      })
      .returning();

    createdJobIds.push(job.id);
    return job;
  }

  async function fabricateCausingEvent(lineage: { causedByRunId: number; rootExecutionId: number; autonomyDepth: number }) {
    const [event] = await db
      .insert(agentEvents)
      .values({
        eventType: 'agent.job.completed',
        eventVersion: 1,
        payload: { jobId: 1, runId: 1 },
        status: 'processed',
        causedByRunId: lineage.causedByRunId,
        rootExecutionId: lineage.rootExecutionId,
        autonomyDepth: lineage.autonomyDepth,
      })
      .returning();

    createdEventIds.push(event.id);
    return event;
  }

  before(async () => {
    await app.ready();

    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);

    ceoToken = await login(ceoEmail, ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.delete(agentEvents).where(inArray(agentEvents.id, createdEventIds));
    }
    if (createdJobIds.length > 0) {
      // cascade: agent_job_runs, agent_event_rules, agent_autonomy_blocks.
      await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));
    }

    await database.end();
    redis.disconnect();
  });

  test('GET /job-runs/:id retorna 404 para id inexistente', async () => {
    const response = await app.inject({ method: 'GET', url: '/agents/job-runs/999999999', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 404);
  });

  test('GET /job-runs/:id/detail compõe run + action plan + items + eventos publicados + Runs filhos', async () => {
    const jobA = await createJob();
    const jobB = await createJob();

    // Root run "manual" (sem LLM: falha determinística llm_unavailable,
    // mas ainda cria um Run real com id/root/lineage — suficiente para o
    // endpoint compor a timeline).
    const rootResult = await runAgentJob(jobA.id, { type: 'manual' }, ceoUserId);
    assert.ok(rootResult.ok);
    const rootRun = rootResult.run;

    const causingEvent = await fabricateCausingEvent({
      causedByRunId: rootRun.id,
      rootExecutionId: rootRun.rootExecutionId!,
      autonomyDepth: 0,
    });

    const childResult = await runAgentJob(jobB.id, { type: 'internal_event', payload: { eventId: causingEvent.id } });
    assert.ok(childResult.ok, 'Job B deveria rodar (primeiro hop autônomo da cadeia).');
    const childRun = childResult.run;

    const response = await app.inject({
      method: 'GET',
      url: `/agents/job-runs/${rootRun.id}/detail`,
      headers: authHeader(ceoToken),
    });
    assert.equal(response.statusCode, 200, response.body);

    const { data } = response.json();
    assert.equal(data.run.id, rootRun.id);
    assert.equal(data.childRuns.length, 1);
    assert.equal(data.childRuns[0].id, childRun.id);
    // Run manual sem LLM falha antes de gerar Action Plan.
    assert.equal(data.actionPlan, null);
    assert.deepEqual(data.planItems, []);
    assert.equal(data.causedByDelivery, null, 'root run não foi causado por nenhuma delivery.');
  });

  test('GET /job-runs/:id/lineage reconstrói a cadeia inteira a partir de um Run intermediário', async () => {
    const jobA = await createJob();
    const jobB = await createJob();

    const rootResult = await runAgentJob(jobA.id, { type: 'manual' }, ceoUserId);
    assert.ok(rootResult.ok);
    const rootRun = rootResult.run;

    const causingEvent = await fabricateCausingEvent({
      causedByRunId: rootRun.id,
      rootExecutionId: rootRun.rootExecutionId!,
      autonomyDepth: 0,
    });

    const childResult = await runAgentJob(jobB.id, { type: 'internal_event', payload: { eventId: causingEvent.id } });
    assert.ok(childResult.ok);
    const childRun = childResult.run;

    // Consulta a cadeia a partir do RUN FILHO (não da raiz) — precisa
    // reconstruir a cadeia inteira mesmo assim.
    const response = await app.inject({
      method: 'GET',
      url: `/agents/job-runs/${childRun.id}/lineage`,
      headers: authHeader(ceoToken),
    });
    assert.equal(response.statusCode, 200, response.body);

    const { data } = response.json();
    assert.equal(data.rootExecutionId, rootRun.rootExecutionId);
    assert.equal(data.runs.length, 2);
    assert.deepEqual(
      data.runs.map((r: { id: number }) => r.id).sort((a: number, b: number) => a - b),
      [rootRun.id, childRun.id].sort((a, b) => a - b),
    );
  });
});
