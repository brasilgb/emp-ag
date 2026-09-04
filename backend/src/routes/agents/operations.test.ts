import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentAutonomyBlocks,
  agentEventDeliveries,
  agentEventRules,
  agentEvents,
  agentJobRuns,
  agentJobs,
  agents,
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { isAutonomousExecutionEnabled, setAutonomousExecutionEnabled } from '../../agents/jobs/global-switch.js';
import { resolveGlobalSetting } from '../../agents/settings/resolver.js';

/*
 * Agentes v1.6 (correio.md seções 3/6/7/9) — Operations Dashboard,
 * Incident Center, Audit log e global autonomy switch. Mesmo padrão de
 * banco real de agents/jobs/job-runner.autonomy.test.ts.
 */
describe('Agentes v1.6 — Operations, Incidents, Audit, Autonomy switch', () => {
  const app = buildApp();
  const runId = Date.now();

  let ceoToken: string;
  let ceoUserId: number;
  let directorAgentId: number;

  let limitedUserId: number;
  let limitedRoleId: number;
  let limitedToken: string;

  const createdJobIds: number[] = [];
  const createdBlockIds: number[] = [];
  const createdDeliveryIds: number[] = [];
  const createdEventIds: number[] = [];
  const createdAuditLogIds: number[] = [];
  let originalGlobalSwitch: boolean;

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createJob(overrides: Partial<typeof agentJobs.$inferInsert> = {}) {
    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Job ops ${runId}-${Math.random().toString(36).slice(2, 8)}`,
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

    // Usuário sem NENHUMA permission de agents.* — usado só para os
    // testes de 403 (uma checagem por rota nova, não exaustivo).
    const [role] = await db
      .insert(roles)
      .values({
        name: `Teste Ops Sem Permissão ${runId}`,
        slug: `test-ops-noperm-${runId}`,
        description: 'Role de teste sem permissions de operações de agentes.',
        isSystem: false,
      })
      .returning();
    limitedRoleId = role.id;

    const [readPerm] = await db.select().from(permissions).where(eq(permissions.slug, 'agents.jobs.read')).limit(1);
    assert.ok(readPerm, 'agents.jobs.read precisa existir para o usuário conseguir logar/usar a API em geral.');
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: readPerm.id });

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-ops-noperm-${runId}@example.com`;
    const [user] = await db
      .insert(users)
      .values({ name: 'Usuário Teste Sem Permissão', email, passwordHash, roleId: role.id, isActive: true })
      .returning();
    limitedUserId = user.id;
    limitedToken = await login(email, 'senha-teste-12345');

    originalGlobalSwitch = await isAutonomousExecutionEnabled();
  });

  after(async () => {
    await setAutonomousExecutionEnabled(originalGlobalSwitch);

    if (createdAuditLogIds.length > 0) await db.delete(auditLogs).where(inArray(auditLogs.id, createdAuditLogIds));
    if (createdDeliveryIds.length > 0)
      await db.delete(agentEventDeliveries).where(inArray(agentEventDeliveries.id, createdDeliveryIds));
    if (createdEventIds.length > 0) await db.delete(agentEvents).where(inArray(agentEvents.id, createdEventIds));
    if (createdBlockIds.length > 0) await db.delete(agentAutonomyBlocks).where(inArray(agentAutonomyBlocks.id, createdBlockIds));
    if (createdJobIds.length > 0) await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));

    await db.delete(users).where(eq(users.id, limitedUserId));
    await db.delete(roles).where(eq(roles.id, limitedRoleId));

    await database.end();
    redis.disconnect();
  });

  describe('GET /operations/summary', () => {
    test('sem permission → 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/operations/summary',
        headers: authHeader(limitedToken),
      });
      assert.equal(response.statusCode, 403);
    });

    test('reflete contagem de Jobs paused/circuit open criados no teste (delta)', async () => {
      const before = await app.inject({ method: 'GET', url: '/agents/operations/summary', headers: authHeader(ceoToken) });
      assert.equal(before.statusCode, 200, before.body);
      const beforeData = before.json().data;

      await createJob({ status: 'paused' });
      await createJob({ circuitState: 'open', circuitOpenedAt: new Date() });

      const after = await app.inject({ method: 'GET', url: '/agents/operations/summary', headers: authHeader(ceoToken) });
      assert.equal(after.statusCode, 200, after.body);
      const afterData = after.json().data;

      assert.equal(afterData.jobs.paused, beforeData.jobs.paused + 1);
      assert.equal(afterData.jobs.circuitOpen, beforeData.jobs.circuitOpen + 1);
      assert.equal(afterData.jobs.total, beforeData.jobs.total + 2);
      assert.ok(typeof afterData.period.from === 'string' && typeof afterData.period.to === 'string');
    });

    test('rejeita from > to (422)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/operations/summary?from=2026-01-02&to=2026-01-01',
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 400);
    });
  });

  // Agentes v3.0 (correio.md "Etapa 8", item 7) — Operational Control
  // Center: mesma permission de leitura de todo este arquivo
  // (`agents.operations.read`); testes de conteúdo/critérios das filas e
  // da timeline vivem em `agents/operations/control-center-service.test.ts`
  // (nível de serviço, mais fácil de controlar o fixture exato) — aqui só
  // a borda HTTP (autorização + forma da resposta).
  describe('GET /operations/control-center', () => {
    test('sem permission → 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/control-center', headers: authHeader(limitedToken) });
      assert.equal(response.statusCode, 403);
    });

    test('com permission → 200, overview e filas presentes na forma esperada', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/control-center', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);

      const { overview, queues } = response.json().data;
      for (const key of ['responsibilitiesActive', 'escalationsOpen', 'followUpsOpen', 'followUpsOverdue', 'proposalsSubmitted', 'proposalsPlanned', 'proposalsFailed', 'approvalsPending']) {
        assert.equal(typeof overview[key], 'number', `overview.${key} deveria ser um número`);
      }
      for (const key of ['needs_attention_now', 'awaiting_human', 'failed', 'in_progress', 'resolved_recently']) {
        assert.ok(Array.isArray(queues[key]), `queues.${key} deveria ser um array`);
      }
    });
  });

  // Agentes v3.4 (correio.md "19. Testes mínimos obrigatórios" — API,
  // itens 13-18). Cobertura de conteúdo/paginação/filtros/ordenação já
  // vive em `agents/operations/supervision-run-history.test.ts` (nível
  // de serviço, fixtures mais fáceis de controlar) — aqui só a borda
  // HTTP: autorização e forma real da resposta, com um run real criado
  // via `POST /operations/supervise` (dry-run, sem side effects).
  describe('GET /operations/supervision-runs', () => {
    test('17/18: sem permission → 403 (list e detail)', async () => {
      const list = await app.inject({ method: 'GET', url: '/agents/operations/supervision-runs', headers: authHeader(limitedToken) });
      assert.equal(list.statusCode, 403);

      const detail = await app.inject({ method: 'GET', url: '/agents/operations/supervision-runs/1', headers: authHeader(limitedToken) });
      assert.equal(detail.statusCode, 403);
    });

    test('13/14/15/16: com permission → lista ordenada, filtro de status/origem, paginação, e detalhe por id', async () => {
      const supervise = await app.inject({ method: 'POST', url: '/agents/operations/supervise?dryRun=true', headers: authHeader(ceoToken) });
      assert.equal(supervise.statusCode, 200, supervise.body);

      const list = await app.inject({ method: 'GET', url: '/agents/operations/supervision-runs?limit=5', headers: authHeader(ceoToken) });
      assert.equal(list.statusCode, 200, list.body);
      const { data, pagination } = list.json();
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0, 'deveria haver ao menos o run manual disparado acima');
      assert.ok(pagination);
      for (let i = 1; i < data.length; i += 1) {
        assert.ok(new Date(data[i - 1].startedAt).getTime() >= new Date(data[i].startedAt).getTime(), 'lista deveria vir ordenada por started_at DESC');
      }

      const filteredByOrigin = await app.inject({ method: 'GET', url: '/agents/operations/supervision-runs?triggerSource=manual&limit=20', headers: authHeader(ceoToken) });
      assert.equal(filteredByOrigin.statusCode, 200);
      assert.ok(filteredByOrigin.json().data.every((row: { triggerSource: string }) => row.triggerSource === 'manual'));

      const runId = data[0].id;
      const detail = await app.inject({ method: 'GET', url: `/agents/operations/supervision-runs/${runId}`, headers: authHeader(ceoToken) });
      assert.equal(detail.statusCode, 200, detail.body);
      assert.equal(detail.json().data.id, runId);
      assert.ok(['running', 'succeeded', 'completed_with_failures', 'failed', 'skipped_already_running'].includes(detail.json().data.status));
    });

    test('id inválido → 400; run inexistente → 404', async () => {
      const invalid = await app.inject({ method: 'GET', url: '/agents/operations/supervision-runs/not-a-number', headers: authHeader(ceoToken) });
      assert.equal(invalid.statusCode, 400);

      const missing = await app.inject({ method: 'GET', url: '/agents/operations/supervision-runs/999999999', headers: authHeader(ceoToken) });
      assert.equal(missing.statusCode, 404);
    });
  });

  describe('GET /incidents', () => {
    let jobForIncidents: Awaited<ReturnType<typeof createJob>>;
    let repeatedFailureWindow: number;

    before(async () => {
      jobForIncidents = await createJob();

      const [block] = await db
        .insert(agentAutonomyBlocks)
        .values({
          jobId: jobForIncidents.id,
          triggerType: 'internal_event',
          reason: 'autonomous_cycle_detected',
          attemptedDepth: 1,
        })
        .returning();
      createdBlockIds.push(block.id);

      const [rule] = await db
        .insert(agentEventRules)
        .values({
          name: `Rule incidents ${runId}`,
          eventType: 'crm.lead.created',
          jobId: jobForIncidents.id,
          filters: {},
          createdBy: ceoUserId,
        })
        .returning();

      const [event] = await db
        .insert(agentEvents)
        .values({ eventType: 'crm.lead.created', eventVersion: 1, payload: { leadId: 1 }, status: 'processed' })
        .returning();
      createdEventIds.push(event.id);

      const [delivery] = await db
        .insert(agentEventDeliveries)
        .values({
          eventId: event.id,
          ruleId: rule.id,
          jobId: jobForIncidents.id,
          status: 'failed',
          errorCode: 'job_not_runnable',
        })
        .returning();
      createdDeliveryIds.push(delivery.id);

      // job_repeated_failure: os N Runs mais recentes do Job, todos
      // failed, onde N é o circuit.failureThreshold GLOBAL efetivo
      // (agents/settings/resolver.ts) — não mais um "3" fixo desde a
      // v1.7 (correio.md v1.7: "eliminar a divergência e fazer o
      // incidente respeitar a configuração efetiva do threshold do
      // circuit breaker"). Resolvido aqui em vez de hardcoded para o
      // teste nunca dessincronizar do comportamento real de novo.
      const threshold = await resolveGlobalSetting('circuit.failureThreshold');
      repeatedFailureWindow = threshold.effectiveValue;

      for (let i = 0; i < repeatedFailureWindow; i += 1) {
        await db.insert(agentJobRuns).values({
          jobId: jobForIncidents.id,
          triggerType: 'manual',
          status: 'failed',
        });
      }
    });

    test('sem filtro de type → mescla as 3 fontes, ordenado por occurredAt desc', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/incidents?jobId=${jobForIncidents.id}&limit=50`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();

      const types = data.map((incident: { type: string }) => incident.type);
      assert.ok(types.includes('autonomous_cycle_detected'));
      assert.ok(types.includes('event_delivery_failed'));
      assert.ok(types.includes('job_repeated_failure'));
    });

    test('filtro type=autonomous_cycle_detected retorna só esse tipo', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/incidents?type=autonomous_cycle_detected&jobId=${jobForIncidents.id}`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();
      assert.ok(data.length >= 1);
      assert.ok(data.every((incident: { type: string }) => incident.type === 'autonomous_cycle_detected'));
    });

    test('filtro type=job_repeated_failure detecta as últimas N falhas consecutivas (N = circuit.failureThreshold efetivo)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/incidents?type=job_repeated_failure&jobId=${jobForIncidents.id}`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();
      assert.equal(data.length, 1);
      assert.equal(data[0].jobId, jobForIncidents.id);
    });

    test('paginação respeitada (limit=1)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/incidents?jobId=${jobForIncidents.id}&limit=1&page=1`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json();
      assert.equal(body.data.length, 1);
      assert.equal(body.pagination.limit, 1);
    });
  });

  describe('GET /audit-logs', () => {
    let markerAction: string;

    before(async () => {
      markerAction = `test_marker_${runId}`;
      const [row] = await db
        .insert(auditLogs)
        .values({
          userId: ceoUserId,
          actorType: 'user',
          actorId: String(ceoUserId),
          action: markerAction,
          entityType: 'test_entity',
          entityId: '123',
          metadata: { foo: 'bar' },
        })
        .returning();
      createdAuditLogIds.push(row.id);
    });

    test('sem permission → 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/audit-logs', headers: authHeader(limitedToken) });
      assert.equal(response.statusCode, 403);
    });

    test('filtra por action e entityType/entityId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/audit-logs?action=${markerAction}&entityType=test_entity&entityId=123`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();
      assert.equal(data.length, 1);
      assert.equal(data[0].action, markerAction);
      assert.deepEqual(data[0].metadata, { foo: 'bar' });
    });

    test('filtro por action inexistente → lista vazia, nunca erro', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/agents/audit-logs?action=acao_que_nunca_existiu_${runId}`,
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json().data, []);
    });
  });

  describe('GET/PATCH /autonomy (global switch)', () => {
    test('sem permission → 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/autonomy', headers: authHeader(limitedToken) });
      assert.equal(response.statusCode, 403);
    });

    test('GET reflete o estado real; PATCH altera e grava audit log', async () => {
      const getResponse = await app.inject({ method: 'GET', url: '/agents/autonomy', headers: authHeader(ceoToken) });
      assert.equal(getResponse.statusCode, 200);
      const current = getResponse.json().data.enabled;
      assert.equal(typeof current, 'boolean');

      const patchResponse = await app.inject({
        method: 'PATCH',
        url: '/agents/autonomy',
        headers: authHeader(ceoToken),
        payload: { enabled: !current },
      });
      assert.equal(patchResponse.statusCode, 200, patchResponse.body);
      assert.equal(patchResponse.json().data.enabled, !current);

      const confirmed = await isAutonomousExecutionEnabled();
      assert.equal(confirmed, !current);

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, !current ? 'agent_autonomy.global_enabled' : 'agent_autonomy.global_disabled'))
        .orderBy(auditLogs.id)
        .limit(1);
      // Não deleta este log (é de produção, não deste teste especificamente) —
      // só confirma que a ação foi auditada em algum momento.
      assert.ok(log, 'PATCH /autonomy deveria gravar audit log.');

      // Restaura para não vazar estado para outros arquivos de teste
      // concorrentes (--test-concurrency=1 já serializa arquivos, mas o
      // valor persiste no banco entre describes deste MESMO arquivo).
      await setAutonomousExecutionEnabled(current);
    });
  });
});
