import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentJobs, agentOperationalSettings, agents, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { resolveSettingsSnapshot } from './resolver.js';

/*
 * Agentes v1.7 (correio.md "Testes obrigatorios") - resolver puro:
 * hierarquia job > global > default, ponte de compatibilidade com a
 * coluna legada, e fail-safe contra valor persistido corrompido. Sem
 * HTTP (ver routes/agents/settings.test.ts para a API).
 */
describe('Agentes v1.7 - AgentOperationalConfigResolver', () => {
  const runId = Date.now();

  let ceoUserId: number;
  let directorAgentId: number;

  const createdJobIds: number[] = [];
  const createdSettingIds: number[] = [];

  async function createJob(overrides: Partial<typeof agentJobs.$inferInsert> = {}) {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Job resolver ${runId}-${Math.random().toString(36).slice(2, 8)}`,
        objective: 'Objetivo de teste',
        agentId: directorAgentId,
        createdBy: ceoUserId,
        status: 'active',
        triggerType: 'internal_event',
        ...overrides,
      })
      .returning();
    createdJobIds.push(job.id);
    return job;
  }

  async function insertSetting(params: { key: string; scope: 'global' | 'job'; scopeId: number | null; value: unknown }) {
    const [row] = await db
      .insert(agentOperationalSettings)
      .values({
        key: params.key,
        scope: params.scope,
        scopeId: params.scopeId,
        value: params.value,
        valueType: 'number',
        updatedBy: ceoUserId,
      })
      .returning();
    createdSettingIds.push(row.id);
    return row;
  }

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    assert.ok(ceoEmail);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;
  });

  afterEach(async () => {
    if (createdSettingIds.length > 0) {
      await db.delete(agentOperationalSettings).where(inArray(agentOperationalSettings.id, createdSettingIds));
      createdSettingIds.length = 0;
    }
  });

  after(async () => {
    if (createdJobIds.length > 0) await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));
    await database.end();
    redis.disconnect();
  });

  test('sem nenhum override -> source "default", valor igual ao catalogo/env', async () => {
    const job = await createJob();
    const snapshot = await resolveSettingsSnapshot({ jobId: job.id });
    const resolved = snapshot['circuit.failureThreshold'];

    assert.equal(resolved.source, 'default');
    assert.equal(resolved.configuredValue, null);
    assert.equal(resolved.effectiveValue, resolved.defaultValue);
  });

  test('override global sem override de Job -> source "global"', async () => {
    const job = await createJob();
    await insertSetting({ key: 'circuit.failureThreshold', scope: 'global', scopeId: null, value: 9 });

    const snapshot = await resolveSettingsSnapshot({ jobId: job.id });
    const resolved = snapshot['circuit.failureThreshold'];

    assert.equal(resolved.source, 'global');
    assert.equal(resolved.effectiveValue, 9);
    assert.equal(resolved.configuredValue, 9);
  });

  test('override de Job vence o global (hierarquia job > global > default)', async () => {
    const job = await createJob();
    await insertSetting({ key: 'circuit.failureThreshold', scope: 'global', scopeId: null, value: 9 });
    await insertSetting({ key: 'circuit.failureThreshold', scope: 'job', scopeId: job.id, value: 2 });

    const snapshot = await resolveSettingsSnapshot({ jobId: job.id });
    const resolved = snapshot['circuit.failureThreshold'];

    assert.equal(resolved.source, 'job');
    assert.equal(resolved.effectiveValue, 2);
  });

  test('override de OUTRO Job nunca vaza para este Job', async () => {
    const jobA = await createJob();
    const jobB = await createJob();
    await insertSetting({ key: 'autonomy.maxDepth', scope: 'job', scopeId: jobA.id, value: 1 });

    const snapshotB = await resolveSettingsSnapshot({ jobId: jobB.id });
    assert.equal(snapshotB['autonomy.maxDepth'].source, 'default');
  });

  test('ponte de compatibilidade: coluna legada agent_jobs.autonomy_rate_limit_override funciona como origem "job" quando a tabela nova nao tem linha', async () => {
    const job = await createJob({ autonomyRateLimitOverride: 7 });

    const snapshot = await resolveSettingsSnapshot({
      jobId: job.id,
      legacyJobOverrides: { autonomyRateLimitOverride: job.autonomyRateLimitOverride, autonomyRateWindowOverrideSeconds: null },
    });

    assert.equal(snapshot['rate.autonomyLimit'].source, 'job');
    assert.equal(snapshot['rate.autonomyLimit'].effectiveValue, 7);
  });

  test('tabela nova vence a coluna legada quando ambas existem para a mesma chave', async () => {
    const job = await createJob({ autonomyRateLimitOverride: 7 });
    await insertSetting({ key: 'rate.autonomyLimit', scope: 'job', scopeId: job.id, value: 3 });

    const snapshot = await resolveSettingsSnapshot({
      jobId: job.id,
      legacyJobOverrides: { autonomyRateLimitOverride: job.autonomyRateLimitOverride, autonomyRateWindowOverrideSeconds: null },
    });

    assert.equal(snapshot['rate.autonomyLimit'].effectiveValue, 3);
  });

  test('fail-safe: valor persistido corrompido (fora de faixa) e ignorado, cai para o proximo escopo', async () => {
    const job = await createJob();
    await insertSetting({ key: 'autonomy.maxDepth', scope: 'global', scopeId: null, value: 9999 });
    await insertSetting({ key: 'autonomy.maxDepth', scope: 'job', scopeId: job.id, value: -5 });

    const snapshot = await resolveSettingsSnapshot({ jobId: job.id });
    const resolved = snapshot['autonomy.maxDepth'];

    // O override de Job (-5) e invalido -> ignorado -> cai para o global,
    // que TAMBEM e invalido (9999 > max) -> ignorado -> cai para o
    // default seguro. Nunca usa um valor fora de faixa.
    assert.equal(resolved.source, 'default');
    assert.equal(resolved.effectiveValue, resolved.defaultValue);
  });

  test('fail-safe: valor persistido com tipo errado (string) e ignorado', async () => {
    const job = await createJob();
    await insertSetting({ key: 'chain.maxRunsPerAutonomyChain', scope: 'global', scopeId: null, value: 'not-a-number' });

    const snapshot = await resolveSettingsSnapshot({ jobId: job.id });
    assert.equal(snapshot['chain.maxRunsPerAutonomyChain'].source, 'default');
  });

  test('jobId null so consulta escopo global (uso da API de leitura global)', async () => {
    const snapshot = await resolveSettingsSnapshot({ jobId: null });
    for (const key of Object.keys(snapshot) as (keyof typeof snapshot)[]) {
      assert.notEqual(snapshot[key].source, 'job');
    }
  });
});
