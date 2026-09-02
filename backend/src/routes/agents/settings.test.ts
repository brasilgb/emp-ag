import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentJobs,
  agentOperationalSettings,
  agents,
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { runAgentJob } from '../../agents/jobs/job-runner.js';

/*
 * Agentes v1.7 (correio.md "Testes obrigatorios") - API administrativa de
 * settings: autorizacao, validacao, CRUD de override, auditoria e
 * integracao real de runtime (mudar um setting muda comportamento
 * observavel).
 */
describe('Agentes v1.7 - API de configuracao operacional (/agents/settings)', () => {
  const app = buildApp();
  const runId = Date.now();

  let ceoToken: string;
  let ceoUserId: number;
  let directorAgentId: number;

  let readOnlyToken: string;
  let readOnlyRoleId: number;
  let readOnlyUserId: number;

  let noPermToken: string;
  let noPermRoleId: number;
  let noPermUserId: number;

  const createdJobIds: number[] = [];
  const createdSettingIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createJob(overrides: Record<string, unknown> = {}) {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Job settings ${runId}-${Math.random().toString(36).slice(2, 8)}`,
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

  async function makeUser(slug: string, permSlugs: string[]) {
    const [role] = await db
      .insert(roles)
      .values({ name: `Teste ${slug} ${runId}`, slug: `${slug}-${runId}`, description: 'Role de teste', isSystem: false })
      .returning();

    if (permSlugs.length > 0) {
      const permRows = await db.select().from(permissions).where(inArray(permissions.slug, permSlugs));
      for (const permission of permRows) {
        await db.insert(rolePermissions).values({ roleId: role.id, permissionId: permission.id });
      }
    }

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-${slug}-${runId}@example.com`;
    const [user] = await db
      .insert(users)
      .values({ name: `Usuario ${slug}`, email, passwordHash, roleId: role.id, isActive: true })
      .returning();

    const token = await login(email, 'senha-teste-12345');
    return { roleId: role.id, userId: user.id, token };
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

    const readOnly = await makeUser('settings-read', ['agents.settings.read', 'agents.jobs.read']);
    readOnlyToken = readOnly.token;
    readOnlyRoleId = readOnly.roleId;
    readOnlyUserId = readOnly.userId;

    const noPerm = await makeUser('settings-none', ['agents.jobs.read']);
    noPermToken = noPerm.token;
    noPermRoleId = noPerm.roleId;
    noPermUserId = noPerm.userId;
  });

  // Chaves globais que algum teste deste arquivo escreve via API (nunca
  // via insert direto rastreavel por id) - limpar por CHAVE a cada teste,
  // nao so por id capturado, e o unico jeito seguro de garantir que
  // nenhum override global escape para os demais arquivos de teste que
  // compartilham este banco (bug real encontrado: um override global de
  // circuit.failureThreshold=1 criado pelo teste de "integracao real de
  // runtime" vazou para job-runner.autonomy.test.ts, abrindo o circuito
  // na 1a falha em vez do threshold default e derrubando 6 testes ali).
  const GLOBAL_KEYS_TOUCHED_BY_THIS_FILE = [
    'circuit.failureThreshold',
    'autonomy.maxDepth',
    'rate.autonomyWindowSeconds',
    'chain.maxRunsPerAutonomyChain',
  ];

  afterEach(async () => {
    if (createdSettingIds.length > 0) {
      await db.delete(agentOperationalSettings).where(inArray(agentOperationalSettings.id, createdSettingIds));
      createdSettingIds.length = 0;
    }

    await db
      .delete(agentOperationalSettings)
      .where(
        and(
          eq(agentOperationalSettings.scope, 'global'),
          inArray(agentOperationalSettings.key, GLOBAL_KEYS_TOUCHED_BY_THIS_FILE),
        ),
      );
  });

  after(async () => {
    if (createdJobIds.length > 0) await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));
    await db.delete(users).where(inArray(users.id, [readOnlyUserId, noPermUserId]));
    await db.delete(roles).where(inArray(roles.id, [readOnlyRoleId, noPermRoleId]));

    await database.end();
    redis.disconnect();
  });

  describe('Autorizacao', () => {
    test('sem nenhuma permission -> GET /settings 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/settings', headers: authHeader(noPermToken) });
      assert.equal(response.statusCode, 403);
    });

    test('agents.settings.read consegue ler mas nao escrever (403 no PATCH)', async () => {
      const getResponse = await app.inject({ method: 'GET', url: '/agents/settings', headers: authHeader(readOnlyToken) });
      assert.equal(getResponse.statusCode, 200);

      const patchResponse = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(readOnlyToken),
        payload: { value: 7 },
      });
      assert.equal(patchResponse.statusCode, 403);
    });

    test('CEO (agents.settings.manage) consegue escrever', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(ceoToken),
        payload: { value: 7 },
      });
      assert.equal(response.statusCode, 200, response.body);
      const [row] = await db
        .select()
        .from(agentOperationalSettings)
        .where(eq(agentOperationalSettings.key, 'circuit.failureThreshold'));
      createdSettingIds.push(row.id);
    });
  });

  describe('Validacao', () => {
    test('chave desconhecida -> 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/nao.existe',
        headers: authHeader(ceoToken),
        payload: { value: 1 },
      });
      assert.equal(response.statusCode, 400);
    });

    test('tipo invalido (string) -> 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(ceoToken),
        payload: { value: 'cinco' },
      });
      assert.equal(response.statusCode, 400);
    });

    test('abaixo do minimo -> 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(ceoToken),
        payload: { value: 0 },
      });
      assert.equal(response.statusCode, 400);
    });

    test('acima do maximo -> 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(ceoToken),
        payload: { value: 999 },
      });
      assert.equal(response.statusCode, 400);
    });

    test('nao-inteiro -> 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(ceoToken),
        payload: { value: 3.5 },
      });
      assert.equal(response.statusCode, 400);
    });
  });

  describe('CRUD de override (global)', () => {
    test('criar, alterar, remover e voltar a herdar o default', async () => {
      const before = await app.inject({
        method: 'GET',
        url: '/agents/settings/autonomy.maxDepth',
        headers: authHeader(ceoToken),
      });
      const beforeData = before.json().data;
      assert.equal(beforeData.source, 'default');

      const create = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/autonomy.maxDepth',
        headers: authHeader(ceoToken),
        payload: { value: 4 },
      });
      assert.equal(create.statusCode, 200, create.body);
      assert.equal(create.json().data.source, 'global');
      assert.equal(create.json().data.effectiveValue, 4);

      const update = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/autonomy.maxDepth',
        headers: authHeader(ceoToken),
        payload: { value: 6 },
      });
      assert.equal(update.json().data.effectiveValue, 6);

      const del = await app.inject({
        method: 'DELETE',
        url: '/agents/settings/autonomy.maxDepth',
        headers: authHeader(ceoToken),
      });
      assert.equal(del.statusCode, 200, del.body);
      assert.equal(del.json().data.source, 'default');
      assert.equal(del.json().data.effectiveValue, beforeData.defaultValue);
    });
  });

  describe('CRUD de override por Job', () => {
    test('override de Job funciona e nao afeta o global', async () => {
      const job = await createJob();

      const patch = await app.inject({
        method: 'PATCH',
        url: `/agents/jobs/${job.id}/settings/chain.maxRunsPerAutonomyChain`,
        headers: authHeader(ceoToken),
        payload: { value: 5 },
      });
      assert.equal(patch.statusCode, 200, patch.body);
      assert.equal(patch.json().data.source, 'job');
      assert.equal(patch.json().data.effectiveValue, 5);

      const globalCheck = await app.inject({
        method: 'GET',
        url: '/agents/settings/chain.maxRunsPerAutonomyChain',
        headers: authHeader(ceoToken),
      });
      assert.equal(globalCheck.json().data.source, 'default');

      const del = await app.inject({
        method: 'DELETE',
        url: `/agents/jobs/${job.id}/settings/chain.maxRunsPerAutonomyChain`,
        headers: authHeader(ceoToken),
      });
      assert.equal(del.json().data.source, 'default');
    });

    test('Job inexistente -> 404', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/agents/jobs/999999999/settings/chain.maxRunsPerAutonomyChain',
        headers: authHeader(ceoToken),
        payload: { value: 5 },
      });
      assert.equal(response.statusCode, 404);
    });
  });

  describe('Auditoria', () => {
    test('PATCH cria agents.settings.override_created; segundo PATCH gera agents.settings.updated; DELETE gera override_removed', async () => {
      const key = 'rate.autonomyWindowSeconds';

      const create = await app.inject({
        method: 'PATCH',
        url: `/agents/settings/${key}`,
        headers: authHeader(ceoToken),
        payload: { value: 120 },
      });
      assert.equal(create.statusCode, 200, create.body);

      const [createdLog] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.settings.override_created'), eq(auditLogs.entityId, key)))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(createdLog);

      const update = await app.inject({
        method: 'PATCH',
        url: `/agents/settings/${key}`,
        headers: authHeader(ceoToken),
        payload: { value: 180 },
      });
      assert.equal(update.statusCode, 200);

      const [updatedLog] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.settings.updated'), eq(auditLogs.entityId, key)))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(updatedLog);
      const metadata = updatedLog.metadata as { previousValue: number; newValue: number; key: string };
      assert.equal(metadata.key, key);
      assert.equal(metadata.previousValue, 120);
      assert.equal(metadata.newValue, 180);

      const del = await app.inject({ method: 'DELETE', url: `/agents/settings/${key}`, headers: authHeader(ceoToken) });
      assert.equal(del.statusCode, 200);

      const [removedLog] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'agents.settings.override_removed'), eq(auditLogs.entityId, key)))
        .orderBy(desc(auditLogs.id))
        .limit(1);
      assert.ok(removedLog);
    });
  });

  describe('Integracao real de runtime', () => {
    test('configurar circuit.failureThreshold=1 (override global) faz o circuito abrir na 1a falha, nao no default', async () => {
      const job = await createJob();

      const patch = await app.inject({
        method: 'PATCH',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(ceoToken),
        payload: { value: 1 },
      });
      assert.equal(patch.statusCode, 200, patch.body);

      // trigger 'schedule' (nao 'manual'): recordAutonomousOutcome so e
      // chamado para triggers nao-manuais (circuit.ts, comentario da
      // v1.5) - execucao manual nunca abre/fecha o circuito. Com
      // AGENT_LLM_ENABLED desligado (default do describe), o Run termina
      // 'failed' de forma deterministica, mesma tecnica de
      // job-runner.autonomy.test.ts.
      const result = await runAgentJob(job.id, { type: 'schedule' });
      assert.ok(result.ok, `Run deveria ter sido criado mesmo terminando failed: ${JSON.stringify(result)}`);
      assert.equal(result.run.status, 'failed');

      const [afterFirstFailure] = await db.select().from(agentJobs).where(eq(agentJobs.id, job.id));
      assert.equal(afterFirstFailure.circuitState, 'open', 'com threshold=1, uma unica falha ja deveria abrir o circuito.');
      assert.equal(afterFirstFailure.circuitFailureCount, 1);

      // Limpeza imediata (nao so no afterEach): este e o unico teste do
      // arquivo que deixa um override GLOBAL de circuit.failureThreshold
      // vivo entre a criacao e o fim do teste - qualquer outro arquivo de
      // teste que rode circuit breaker com o threshold default enquanto
      // essa linha existir vai abrir o circuito na 1a falha em vez do
      // threshold real (bug real encontrado: derrubou 6 testes de
      // job-runner.autonomy.test.ts rodando na mesma invocacao). Fechar a
      // janela aqui, no fim do proprio teste, e mais robusto que confiar
      // so no afterEach.
      await app.inject({
        method: 'DELETE',
        url: '/agents/settings/circuit.failureThreshold',
        headers: authHeader(ceoToken),
      });
    });
  });
});
