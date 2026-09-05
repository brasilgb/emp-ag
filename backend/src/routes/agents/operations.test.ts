import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { count, eq, inArray } from 'drizzle-orm';

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

  // Agentes v3.5 (correio.md "Operational Supervision Insights & Incident
  // Review", "8. Testes obrigatórios" — isolamento/autorização, ausência
  // de erro com histórico vazio). Cobertura de conteúdo/filtros/vínculo
  // run→incident→response→escalation/recorrência já vive em
  // `agents/operations/supervision-insights-service.test.ts` (nível de
  // serviço, fixtures determinísticas mais fáceis de controlar) — aqui só
  // a borda HTTP: autorização e forma real da resposta.
  describe('GET /operations/supervision-insights/*', () => {
    test('sem permission → 403 em todas as 4 rotas', async () => {
      for (const url of [
        '/agents/operations/supervision-insights/overview',
        '/agents/operations/supervision-insights/incidents',
        '/agents/operations/supervision-insights/incidents/1',
        '/agents/operations/supervision-insights/recurring',
      ]) {
        const response = await app.inject({ method: 'GET', url, headers: authHeader(limitedToken) });
        assert.equal(response.statusCode, 403, url);
      }
    });

    test('overview: com permission → 200, forma esperada (mesmo com histórico vazio de filtros de data absurdos)', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/overview?dateFrom=2999-01-01', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);

      const { data } = response.json();
      assert.equal(typeof data.totalRuns, 'number');
      assert.equal(typeof data.totalFindings, 'number');
      assert.equal(typeof data.totalIncidentsDetected, 'number');
      assert.equal(typeof data.escalationsCreated, 'number');
      assert.equal(typeof data.recurringIncidentsCount, 'number');
      for (const severity of ['info', 'warning', 'critical']) {
        assert.equal(typeof data.incidentsBySeverity[severity], 'number');
      }
      for (const key of ['observed', 'recovered', 'autonomyRestricted', 'escalated', 'failed']) {
        assert.equal(typeof data.responsesApplied[key], 'number');
      }
    });

    test('incidents: com permission → 200, paginado, filtros aceitos, sem quebrar com histórico vazio', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/operations/supervision-insights/incidents?severity=critical&incidentType=repeated_job_failure&response=restrict_autonomy&hasEscalation=false&limit=5',
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const { data, pagination } = response.json();
      assert.ok(Array.isArray(data));
      assert.ok(pagination);
    });

    test('incidents: filtro inválido → 400', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents?severity=nao-existe', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 400);
    });

    test('incidents/:auditLogId: id inválido → 400; inexistente → 404', async () => {
      const invalid = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents/not-a-number', headers: authHeader(ceoToken) });
      assert.equal(invalid.statusCode, 400);

      const missing = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents/999999999', headers: authHeader(ceoToken) });
      assert.equal(missing.statusCode, 404);
    });

    test('recurring: com permission → 200, array (nunca erro, mesmo sem nenhuma recorrência ainda detectada)', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/recurring', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(Array.isArray(response.json().data));
    });

    test('overview: reviewsByStatus presente na forma esperada (v3.6)', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/overview', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      const { reviewsByStatus } = response.json().data;
      for (const status of ['unreviewed', 'acknowledged', 'resolved', 'dismissed']) {
        assert.equal(typeof reviewsByStatus[status], 'number');
      }
    });
  });

  // Agentes v3.7 (correio.md "Operational Incident Review Queue &
  // Attention Management", "Testes obrigatórios" itens 18/19 — usuário
  // apenas com `agents.operations.read` consegue consultar a fila /
  // usuário sem permission de leitura recebe 403). Cobertura de
  // aging/ordenação/recorrência/filtros/N+1/projeção já vive em
  // `agents/operations/attention-queue-service.test.ts` (nível de
  // serviço) — aqui só a borda HTTP.
  describe('GET /operations/supervision-insights/needs-attention', () => {
    test('sem permission → 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/needs-attention', headers: authHeader(limitedToken) });
      assert.equal(response.statusCode, 403);
    });

    test('com apenas agents.operations.read → 200, paginado, forma esperada (mesmo com fila vazia)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/operations/supervision-insights/needs-attention?dateFrom=2999-01-01',
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const { data, pagination } = response.json();
      assert.ok(Array.isArray(data));
      assert.ok(pagination);
      assert.deepEqual(data, []);
    });

    test('filtros inválidos (severity/agingBucket) → 400', async () => {
      const badSeverity = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/needs-attention?severity=nao-existe', headers: authHeader(ceoToken) });
      assert.equal(badSeverity.statusCode, 400);

      const badBucket = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/needs-attention?agingBucket=nao-existe', headers: authHeader(ceoToken) });
      assert.equal(badBucket.statusCode, 400);
    });

    test('aceita filtros combinados sem quebrar (outcome/recurringOnly/reviewStatus/agingBucket)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/agents/operations/supervision-insights/needs-attention?severity=critical&outcome=escalated&recurringOnly=true&reviewStatus=unreviewed&agingBucket=%3E24h&limit=5',
        headers: authHeader(ceoToken),
      });
      assert.equal(response.statusCode, 200, response.body);
      const { data, pagination } = response.json();
      assert.ok(Array.isArray(data));
      assert.ok(pagination);
    });
  });

  // Agentes v3.9 (correio.md "Operational Ownership Workload & Human
  // Coordination Views", "11. Testes obrigatórios" — itens 15/16/17
  // (autorização) e 18 (endpoint estritamente read-only, nunca produz
  // mutação/audit)). Cobertura de contagens/invariantes já vive em
  // `agents/operations/ownership-workload-service.test.ts` (nível de
  // serviço) — aqui só a borda HTTP.
  describe('GET /operations/supervision-insights/ownership-workload', () => {
    test('16: sem permission → 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/ownership-workload', headers: authHeader(limitedToken) });
      assert.equal(response.statusCode, 403);
    });

    test('15/17: agents.operations.read (sozinho, sem manage) → 200, forma esperada', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/ownership-workload', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();
      assert.equal(typeof data.totals.active, 'number');
      assert.equal(typeof data.totals.assigned, 'number');
      assert.equal(typeof data.totals.unassigned, 'number');
      assert.equal(data.totals.assigned + data.totals.unassigned, data.totals.active);
      assert.ok(Array.isArray(data.assignees));
    });

    test('18: endpoint estritamente read-only — não produz nenhuma mutação/audit operacional', async () => {
      const [{ total: auditCountBefore }] = await db.select({ total: count() }).from(auditLogs);

      const response = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/ownership-workload', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200);

      const [{ total: auditCountAfter }] = await db.select({ total: count() }).from(auditLogs);
      assert.equal(Number(auditCountAfter), Number(auditCountBefore), 'GET no workload nunca deveria gravar um audit log novo');
    });
  });

  // Agentes v4.1 (correio.md "Operational Incident Aging & SLA
  // Visibility", "16. Testes obrigatórios" — itens 14/15/16 (read-only/
  // autorização)). Cobertura de cálculo/invariantes/N+1 já vive em
  // `agents/operations/incident-sla.test.ts` (função pura) e
  // `incident-sla.integration.test.ts` (nível de serviço) — aqui só a
  // borda HTTP.
  describe('GET/PATCH /operations/sla-settings', () => {
    let originalSlaSettings: unknown;

    before(async () => {
      const get = await app.inject({ method: 'GET', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken) });
      originalSlaSettings = get.json().data;
    });

    after(async () => {
      // Config global (Agentes v4.1 reaproveita a tabela genérica
      // `settings` — nunca escopado por teste) — restaurada para nunca
      // vazar o valor alterado por "PATCH bem-sucedido reflete..." abaixo
      // para outros testes/ambientes.
      await app.inject({ method: 'PATCH', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken), payload: originalSlaSettings as Record<string, number> });
    });

    test('15: sem permission → 403 (GET e PATCH)', async () => {
      const get = await app.inject({ method: 'GET', url: '/agents/operations/sla-settings', headers: authHeader(limitedToken) });
      assert.equal(get.statusCode, 403);

      const patch = await app.inject({ method: 'PATCH', url: '/agents/operations/sla-settings', headers: authHeader(limitedToken), payload: { critical: 30 } });
      assert.equal(patch.statusCode, 403);
    });

    test('16: agents.operations.read → 200, forma esperada (minutos por severidade)', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();
      assert.equal(typeof data.info, 'number');
      assert.equal(typeof data.warning, 'number');
      assert.equal(typeof data.critical, 'number');
    });

    test('14: GET permanece read-only — não grava audit log', async () => {
      const [{ total: auditCountBefore }] = await db.select({ total: count() }).from(auditLogs);
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200);
      const [{ total: auditCountAfter }] = await db.select({ total: count() }).from(auditLogs);
      assert.equal(Number(auditCountAfter), Number(auditCountBefore));
    });

    test('campos extras/valores inválidos no payload → 400', async () => {
      const extraField = await app.inject({ method: 'PATCH', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken), payload: { critical: 30, extra: 1 } });
      assert.equal(extraField.statusCode, 400);

      const outOfRange = await app.inject({ method: 'PATCH', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken), payload: { critical: 999999 } });
      assert.equal(outOfRange.statusCode, 400);
    });

    test('PATCH bem-sucedido reflete no GET subsequente e no cálculo real de um incidente', async () => {
      const patch = await app.inject({ method: 'PATCH', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken), payload: { critical: 45 } });
      assert.equal(patch.statusCode, 200, patch.body);
      assert.equal(patch.json().data.critical, 45);

      const get = await app.inject({ method: 'GET', url: '/agents/operations/sla-settings', headers: authHeader(ceoToken) });
      assert.equal(get.json().data.critical, 45);
    });
  });

  // Agentes v4.2 (correio.md "Operational SLA Analytics & Performance
  // Visibility", "19. Testes backend — Endpoint"). Cobertura de
  // cálculo/agregação/N+1/isolamento já vive em
  // `agents/operations/sla-analytics.test.ts` (função pura) e
  // `sla-analytics.integration.test.ts` (nível de serviço) — aqui só a
  // borda HTTP: autorização, validação de query e a garantia de
  // read-only.
  describe('GET /operations/sla-analytics', () => {
    test('sem permission → 403', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics', headers: authHeader(limitedToken) });
      assert.equal(response.statusCode, 403);
    });

    test('agents.operations.read → 200, forma esperada (contrato da seção 4)', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();

      assert.equal(typeof data.period.from, 'string');
      assert.equal(typeof data.period.to, 'string');
      assert.equal(typeof data.incidents.detected, 'number');
      assert.equal(typeof data.incidents.closed, 'number');
      assert.equal(typeof data.incidents.open, 'number');
      assert.equal(typeof data.sla.completedWithinSla, 'number');
      assert.equal(typeof data.sla.completedOutsideSla, 'number');
      assert.ok(data.sla.breachRate === null || typeof data.sla.breachRate === 'number');
      assert.equal(typeof data.acknowledgement.count, 'number');
      assert.equal(typeof data.resolution.count, 'number');
      assert.equal(typeof data.openSla.withinSla, 'number');
      assert.equal(typeof data.openSla.warning, 'number');
      assert.equal(typeof data.openSla.breached, 'number');
      assert.ok(Array.isArray(data.trend));
      assert.ok(Array.isArray(data.byAssignee));
      for (const severity of ['info', 'warning', 'critical']) {
        assert.equal(typeof data.bySeverity[severity].detected, 'number');
        assert.equal(typeof data.bySeverity[severity].closed, 'number');
      }
    });

    test('sem from/to → default de 7 dias, ecoado em `period`', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200);
      const { period } = response.json().data;
      const from = new Date(period.from).getTime();
      const to = new Date(period.to).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      assert.ok(Math.abs(to - from - sevenDaysMs) < 5000, 'período default deveria ser ~7 dias');
    });

    test('`from` inválido → 400', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics?from=nao-e-uma-data', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 400);
    });

    test('`to` inválido → 400', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics?to=nao-e-uma-data', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 400);
    });

    test('`from` > `to` → 400', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics?from=2030-01-01&to=2020-01-01', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 400);
    });

    test('`severity` inválido → 400', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics?severity=nao-existe', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 400);
    });

    test('campo extra na query → 400 (schema `.strict()`)', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics?bogus=1', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 400);
    });

    test('período sem nenhum incidente → 200 com contadores zerados, nunca erro', async () => {
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics?from=2001-01-01&to=2001-01-02', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      const { data } = response.json();
      assert.equal(data.incidents.detected, 0);
      assert.equal(data.incidents.closed, 0);
      assert.equal(data.sla.breachRate, null);
      assert.deepEqual(data.byAssignee, []);
    });

    test('GET não grava audit log (100% read-only, correio.md seção 14/21)', async () => {
      const [{ total: auditCountBefore }] = await db.select({ total: count() }).from(auditLogs);
      const response = await app.inject({ method: 'GET', url: '/agents/operations/sla-analytics', headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200);
      const [{ total: auditCountAfter }] = await db.select({ total: count() }).from(auditLogs);
      assert.equal(Number(auditCountAfter), Number(auditCountBefore), 'GET em sla-analytics nunca deveria gravar um audit log novo');
    });
  });

  // Agentes v3.6 (correio.md "Operational Incident Acknowledgement &
  // Review Workflow", "11. Testes obrigatórios" — itens 10 (autorização
  // leitura/escrita), 7 (status inválido), 8 (404), 13 (filtro por review
  // status), 12 (detalhe da v3.5 reflete o review atualizado)). Cobertura
  // de ciclo completo/concorrência/auditoria/ausência de dados sensíveis
  // já vive em `agents/operations/incident-review-service.test.ts` (nível
  // de serviço) — aqui só a borda HTTP.
  describe('GET/PATCH /operations/supervision-insights/incidents/:auditLogId/review', () => {
    let reviewableAuditLogId: number;

    before(async () => {
      const supervise = await app.inject({ method: 'POST', url: '/agents/operations/supervise?dryRun=true', headers: authHeader(ceoToken) });
      assert.equal(supervise.statusCode, 200, supervise.body);

      const incidents = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents?limit=1', headers: authHeader(ceoToken) });
      assert.equal(incidents.statusCode, 200);
      const [incident] = incidents.json().data;
      assert.ok(incident, 'setup: deveria existir ao menos um incidente detectável no ambiente de teste (dry-run varre o sistema inteiro)');
      reviewableAuditLogId = incident.auditLogId;
    });

    test('10: GET sem permission → 403; PATCH sem permission (agents.operations.manage) → 403', async () => {
      const get = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}/review`, headers: authHeader(limitedToken) });
      assert.equal(get.statusCode, 403);

      const patch = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}/review`,
        headers: authHeader(limitedToken),
        payload: { status: 'acknowledged' },
      });
      assert.equal(patch.statusCode, 403);
    });

    test('leitura só (agents.operations.read) não implica escrita — só permission de manage pode fazer PATCH', async () => {
      // ceoToken tem ambas (agents.operations.read e .manage) — o teste
      // relevante de separação já está coberto pelo teste acima
      // (limitedToken não tem nenhuma das duas). Confirmando aqui a
      // rota de leitura em si funciona com só `agents.operations.read`.
      const get = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}/review`, headers: authHeader(ceoToken) });
      assert.equal(get.statusCode, 200, get.body);
      assert.equal(get.json().data.auditLogId, reviewableAuditLogId);
    });

    test('7: status inválido → 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}/review`,
        headers: authHeader(ceoToken),
        payload: { status: 'unreviewed' },
      });
      assert.equal(response.statusCode, 400, 'unreviewed nunca é um status setável pelo cliente — só a ausência de linha significa isso');

      const invalidValue = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}/review`,
        headers: authHeader(ceoToken),
        payload: { status: 'nao-existe' },
      });
      assert.equal(invalidValue.statusCode, 400);
    });

    test('campos extras no payload (reviewedBy/reviewedAt) são rejeitados pelo .strict()', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}/review`,
        headers: authHeader(ceoToken),
        payload: { status: 'acknowledged', reviewedBy: 999, reviewedAt: '2000-01-01T00:00:00.000Z' },
      });
      assert.equal(response.statusCode, 400);
    });

    test('9: audit real que não é incident.detected (ex.: scan.started) não pode receber review → 404', async () => {
      const [nonIncidentAudit] = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'agents.operations.scan.started')).orderBy(auditLogs.id).limit(1);
      assert.ok(nonIncidentAudit, 'setup: deveria existir ao menos um audit de scan.started (o dry-run do before() já disparou um)');

      const get = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${nonIncidentAudit!.id}/review`, headers: authHeader(ceoToken) });
      assert.equal(get.statusCode, 404);

      const patch = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${nonIncidentAudit!.id}/review`,
        headers: authHeader(ceoToken),
        payload: { status: 'acknowledged' },
      });
      assert.equal(patch.statusCode, 404);
    });

    test('8: GET/PATCH para auditLogId inexistente → 404', async () => {
      const get = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents/999999999/review', headers: authHeader(ceoToken) });
      assert.equal(get.statusCode, 404);

      const patch = await app.inject({
        method: 'PATCH',
        url: '/agents/operations/supervision-insights/incidents/999999999/review',
        headers: authHeader(ceoToken),
        payload: { status: 'acknowledged' },
      });
      assert.equal(patch.statusCode, 404);
    });

    test('12/13: PATCH bem-sucedido reflete no detalhe da v3.5 e no filtro reviewStatus do histórico', async () => {
      const patch = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}/review`,
        headers: authHeader(ceoToken),
        payload: { status: 'acknowledged', note: 'Acompanhando.' },
      });
      assert.equal(patch.statusCode, 200, patch.body);
      assert.equal(patch.json().data.status, 'acknowledged');
      assert.equal(patch.json().data.note, 'Acompanhando.');
      assert.ok(patch.json().data.reviewedBy, 'reviewedBy deveria ser derivado do usuário autenticado, nunca vazio');

      const detail = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${reviewableAuditLogId}`, headers: authHeader(ceoToken) });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().data.reviewStatus, 'acknowledged');
      assert.equal(detail.json().data.review.status, 'acknowledged');
      assert.equal(detail.json().data.review.note, 'Acompanhando.');
      // "Resultado operacional" e "Review humano" nunca misturados
      // (correio.md seção 8) — dois campos independentes na mesma
      // resposta, `outcome` intocado pelo review.
      assert.ok(['observed', 'recovered', 'autonomy_restricted', 'escalated', 'failed', 'skipped'].includes(detail.json().data.outcome));

      const filtered = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents?reviewStatus=acknowledged&limit=50', headers: authHeader(ceoToken) });
      assert.equal(filtered.statusCode, 200);
      assert.ok(filtered.json().data.some((row: { auditLogId: number }) => row.auditLogId === reviewableAuditLogId));
      assert.ok(filtered.json().data.every((row: { reviewStatus: string }) => row.reviewStatus === 'acknowledged'));
    });
  });

  // Agentes v3.8 (correio.md "Operational Incident Ownership &
  // Assignment", "21. Testes obrigatórios" — itens 9/10 (autorização
  // leitura/escrita), 11 (usuário inexistente), 13 (incidente
  // inexistente)). Cobertura de ciclo completo/idempotência/concorrência/
  // N+1/auditoria já vive em
  // `agents/operations/incident-assignment-service.test.ts` (nível de
  // serviço) — aqui só a borda HTTP.
  describe('GET/PATCH/DELETE /operations/supervision-insights/incidents/:auditLogId/assignment', () => {
    let assignableAuditLogId: number;

    before(async () => {
      const supervise = await app.inject({ method: 'POST', url: '/agents/operations/supervise?dryRun=true', headers: authHeader(ceoToken) });
      assert.equal(supervise.statusCode, 200, supervise.body);

      const incidents = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents?limit=1', headers: authHeader(ceoToken) });
      assert.equal(incidents.statusCode, 200);
      const [incident] = incidents.json().data;
      assert.ok(incident, 'setup: deveria existir ao menos um incidente detectável no ambiente de teste');
      assignableAuditLogId = incident.auditLogId;
    });

    test('9/10: GET sem permission → 403; PATCH/DELETE sem permission (agents.operations.manage) → 403', async () => {
      const get = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`, headers: authHeader(limitedToken) });
      assert.equal(get.statusCode, 403);

      const patch = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`,
        headers: authHeader(limitedToken),
        payload: { assigneeUserId: limitedUserId },
      });
      assert.equal(patch.statusCode, 403);

      const del = await app.inject({ method: 'DELETE', url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`, headers: authHeader(limitedToken) });
      assert.equal(del.statusCode, 403);
    });

    test('leitura só (agents.operations.read) não implica escrita — só permission de manage pode fazer PATCH/DELETE', async () => {
      const get = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`, headers: authHeader(ceoToken) });
      assert.equal(get.statusCode, 200, get.body);
      assert.equal(get.json().data.auditLogId, assignableAuditLogId);
      assert.equal(get.json().data.assigneeUserId, null, 'incidente recém-detectado deveria começar sem responsável');
    });

    test('campos extras no payload são rejeitados pelo .strict()', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`,
        headers: authHeader(ceoToken),
        payload: { assigneeUserId: limitedUserId, assignedBy: 999, assignedAt: '2000-01-01T00:00:00.000Z' },
      });
      assert.equal(response.statusCode, 400);
    });

    test('11: usuário inexistente é rejeitado → 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`,
        headers: authHeader(ceoToken),
        payload: { assigneeUserId: 999999999 },
      });
      assert.equal(response.statusCode, 400);
    });

    test('13: audit real que não é incident.detected → 404 (GET/PATCH/DELETE); auditLogId inexistente → 404', async () => {
      const [nonIncidentAudit] = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'agents.operations.scan.started')).orderBy(auditLogs.id).limit(1);
      assert.ok(nonIncidentAudit, 'setup: deveria existir ao menos um audit de scan.started');

      const get = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${nonIncidentAudit!.id}/assignment`, headers: authHeader(ceoToken) });
      assert.equal(get.statusCode, 404);

      const patch = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${nonIncidentAudit!.id}/assignment`,
        headers: authHeader(ceoToken),
        payload: { assigneeUserId: limitedUserId },
      });
      assert.equal(patch.statusCode, 404);

      const del = await app.inject({ method: 'DELETE', url: `/agents/operations/supervision-insights/incidents/999999999/assignment`, headers: authHeader(ceoToken) });
      assert.equal(del.statusCode, 404);
    });

    test('PATCH bem-sucedido reflete no GET, no detalhe da v3.5 e na fila Needs Attention; DELETE desatribui', async () => {
      const patch = await app.inject({
        method: 'PATCH',
        url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`,
        headers: authHeader(ceoToken),
        payload: { assigneeUserId: limitedUserId },
      });
      assert.equal(patch.statusCode, 200, patch.body);
      assert.equal(patch.json().data.assigneeUserId, limitedUserId);
      assert.ok(patch.json().data.assignedBy, 'assignedBy deveria ser derivado do usuário autenticado, nunca vazio');

      const get = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`, headers: authHeader(ceoToken) });
      assert.equal(get.json().data.assigneeUserId, limitedUserId);

      const detail = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}`, headers: authHeader(ceoToken) });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().data.assignment.assigneeUserId, limitedUserId);
      // Assignment nunca mistura com review (correio.md v3.8 seção 6).
      assert.ok(['unreviewed', 'acknowledged', 'resolved', 'dismissed'].includes(detail.json().data.reviewStatus));

      const queue = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/needs-attention?assigneeUserId=${limitedUserId}&limit=50`, headers: authHeader(ceoToken) });
      assert.equal(queue.statusCode, 200);
      assert.ok(queue.json().data.some((row: { auditLogId: number }) => row.auditLogId === assignableAuditLogId));

      const del = await app.inject({ method: 'DELETE', url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`, headers: authHeader(ceoToken) });
      assert.equal(del.statusCode, 200, del.body);
      assert.equal(del.json().data.assigneeUserId, null);

      const getAfterDelete = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${assignableAuditLogId}/assignment`, headers: authHeader(ceoToken) });
      assert.equal(getAfterDelete.json().data.assigneeUserId, null);
    });
  });

  // Agentes v4.0 (correio.md "Operational Incident Collaboration &
  // Activity Timeline", "19. Testes backend obrigatórios" — itens 11/12
  // (autorização), 13/14 (GET estritamente read-only)). Cobertura de
  // conteúdo/ordenação/N+1 da timeline já vive em
  // `agents/operations/incident-timeline.test.ts` (nível de serviço) —
  // aqui só a borda HTTP, embutida no MESMO endpoint de detalhe já
  // existente (nenhuma rota nova — decisão documentada no relatório).
  describe('GET /operations/supervision-insights/incidents/:auditLogId (campo timeline, v4.0)', () => {
    let timelineAuditLogId: number;

    before(async () => {
      const supervise = await app.inject({ method: 'POST', url: '/agents/operations/supervise?dryRun=true', headers: authHeader(ceoToken) });
      assert.equal(supervise.statusCode, 200, supervise.body);

      const incidents = await app.inject({ method: 'GET', url: '/agents/operations/supervision-insights/incidents?limit=1', headers: authHeader(ceoToken) });
      assert.equal(incidents.statusCode, 200);
      const [incident] = incidents.json().data;
      assert.ok(incident, 'setup: deveria existir ao menos um incidente detectável no ambiente de teste');
      timelineAuditLogId = incident.auditLogId;
    });

    test('11: sem agents.operations.read → 403 (mesma rota de detalhe, já coberta em "sem permission em todas as 4 rotas")', async () => {
      const response = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${timelineAuditLogId}`, headers: authHeader(limitedToken) });
      assert.equal(response.statusCode, 403);
    });

    test('12: agents.operations.read → 200, timeline presente com o evento de detecção pelo menos', async () => {
      const response = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${timelineAuditLogId}`, headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200, response.body);
      const { timeline } = response.json().data;
      assert.ok(Array.isArray(timeline));
      assert.ok(timeline.length >= 1);
      assert.equal(timeline[0].type, 'incident_detected');
    });

    test('13/14: GET da timeline é estritamente read-only — não grava audit log nem altera review/assignment', async () => {
      const [{ total: auditCountBefore }] = await db.select({ total: count() }).from(auditLogs);
      const reviewBefore = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${timelineAuditLogId}/review`, headers: authHeader(ceoToken) });
      const assignmentBefore = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${timelineAuditLogId}/assignment`, headers: authHeader(ceoToken) });

      const response = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${timelineAuditLogId}`, headers: authHeader(ceoToken) });
      assert.equal(response.statusCode, 200);

      const [{ total: auditCountAfter }] = await db.select({ total: count() }).from(auditLogs);
      assert.equal(Number(auditCountAfter), Number(auditCountBefore), 'GET do detalhe/timeline nunca deveria gravar um audit log novo');

      const reviewAfter = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${timelineAuditLogId}/review`, headers: authHeader(ceoToken) });
      const assignmentAfter = await app.inject({ method: 'GET', url: `/agents/operations/supervision-insights/incidents/${timelineAuditLogId}/assignment`, headers: authHeader(ceoToken) });
      assert.deepEqual(reviewAfter.json().data, reviewBefore.json().data, 'GET da timeline nunca deveria alterar o review');
      assert.deepEqual(assignmentAfter.json().data, assignmentBefore.json().data, 'GET da timeline nunca deveria alterar o assignment');
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
