import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentEventRules, agentJobs, agents, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

/*
 * Testes de integração de Event Rules (correio.md v1.4 seção 20/21/26).
 * Mesmo padrão de routes/agents/jobs.test.ts.
 */

describe('Agentes v1.4 — Event Rules', () => {
  const app = buildApp();
  const runId = Date.now();

  let ceoToken: string;
  let ceoUserId: number;
  let jobId: number;

  const createdRuleIds: number[] = [];
  const createdJobIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
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

    const [job] = await db
      .insert(agentJobs)
      .values({
        name: `Job para Event Rules ${runId}`,
        objective: 'Objetivo de teste',
        agentId: director.id,
        createdBy: ceoUserId,
        // 'paused', não 'active': este arquivo só testa o CRUD de Event
        // Rules, nunca despacho real — mas as rules que cria são reais e
        // ficam com event_type='crm.lead.created', o mesmo tipo usado por
        // outros arquivos de teste que rodam em paralelo (node:test roda
        // arquivos em processos concorrentes). Um Job 'paused' garante que,
        // mesmo que uma dessas rules "case" com um evento publicado por
        // outro arquivo enquanto ainda existe, runAgentJob nunca chega a
        // criar um Run de verdade (job_not_runnable) — nunca contamina a
        // contagem de Runs de outro teste. A limpeza por afterEach abaixo
        // ainda encurta a janela de exposição ao mínimo.
        status: 'paused',
        triggerType: 'internal_event',
      })
      .returning();
    jobId = job.id;
    createdJobIds.push(job.id);
  });

  // Limpeza por teste (não só no after() final): uma rule
  // event_type='crm.lead.created' habilitada, mesmo apontando para um Job
  // pausado, ainda "casa" (evaluateFilters) e gera uma agent_event_delivery
  // para qualquer evento crm.lead.created publicado por OUTRO arquivo de
  // teste rodando em paralelo enquanto ela existir — isso quebraria
  // asserções de "nenhuma rule deveria casar" em event-processor.test.ts.
  // Deletar a cada teste em vez de só no final reduz essa janela ao
  // mínimo possível.
  afterEach(async () => {
    if (createdRuleIds.length > 0) {
      await db.delete(agentEventRules).where(inArray(agentEventRules.id, createdRuleIds));
      createdRuleIds.length = 0;
    }
  });

  after(async () => {
    if (createdJobIds.length > 0) await db.delete(agentJobs).where(inArray(agentJobs.id, createdJobIds));

    await database.end();
    redis.disconnect();
  });

  test('criar rule válida', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: {
        name: `Rule teste ${runId}`,
        eventType: 'crm.lead.created',
        jobId,
        filters: { probability: { gte: 70 } },
      },
    });

    assert.equal(response.statusCode, 201, response.body);
    createdRuleIds.push(response.json().data.id);
    assert.equal(response.json().data.enabled, true);
  });

  test('rejeita event_type inexistente no catálogo', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: { name: 'x', eventType: 'crm.lead.deleted', jobId, filters: {} },
    });

    assert.equal(response.statusCode, 400);
  });

  test('rejeita operador não permitido (fora da lista fechada)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: {
        name: 'x',
        eventType: 'crm.lead.created',
        jobId,
        filters: { probability: { $where: '1=1' } },
      },
    });

    assert.equal(response.statusCode, 400);
  });

  test('rejeita campo não filterable para o event_type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: {
        name: 'x',
        eventType: 'crm.lead.created',
        jobId,
        filters: { name: { eq: 'qualquer' } },
      },
    });

    assert.equal(response.statusCode, 400);
  });

  test('rejeita job_id inexistente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: { name: 'x', eventType: 'crm.lead.created', jobId: 999999999, filters: {} },
    });

    assert.equal(response.statusCode, 404);
  });

  test('listar rules', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: { name: `Rule listagem ${runId}`, eventType: 'crm.lead.created', jobId, filters: {} },
    });
    createdRuleIds.push(created.json().data.id);

    const response = await app.inject({ method: 'GET', url: '/agents/event-rules', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().data.some((rule: { id: number }) => rule.id === created.json().data.id));
  });

  test('alterar filtros e ativar/desativar', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: { name: `Rule editar ${runId}`, eventType: 'crm.lead.created', jobId, filters: {} },
    });
    const ruleId = created.json().data.id;
    createdRuleIds.push(ruleId);

    const disableResponse = await app.inject({
      method: 'PATCH',
      url: `/agents/event-rules/${ruleId}`,
      headers: authHeader(ceoToken),
      payload: { enabled: false },
    });
    assert.equal(disableResponse.statusCode, 200);
    assert.equal(disableResponse.json().data.enabled, false);

    const filtersResponse = await app.inject({
      method: 'PATCH',
      url: `/agents/event-rules/${ruleId}`,
      headers: authHeader(ceoToken),
      payload: { filters: { probability: { gte: 50 } }, enabled: true },
    });
    assert.equal(filtersResponse.statusCode, 200);
    assert.deepEqual(filtersResponse.json().data.filters, { probability: { gte: 50 } });
    assert.equal(filtersResponse.json().data.enabled, true);
  });

  test('PATCH rejeita filtro incompatível com o event_type já fixado na rule', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: { name: `Rule patch inválido ${runId}`, eventType: 'crm.lead.created', jobId, filters: {} },
    });
    const ruleId = created.json().data.id;
    createdRuleIds.push(ruleId);

    const response = await app.inject({
      method: 'PATCH',
      url: `/agents/event-rules/${ruleId}`,
      headers: authHeader(ceoToken),
      payload: { filters: { name: { eq: 'x' } } },
    });

    assert.equal(response.statusCode, 400);
  });

  test('remover rule', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: { name: `Rule remover ${runId}`, eventType: 'crm.lead.created', jobId, filters: {} },
    });
    const ruleId = created.json().data.id;

    const deleteResponse = await app.inject({ method: 'DELETE', url: `/agents/event-rules/${ruleId}`, headers: authHeader(ceoToken) });
    assert.equal(deleteResponse.statusCode, 204);

    const getResponse = await app.inject({ method: 'GET', url: `/agents/event-rules/${ruleId}`, headers: authHeader(ceoToken) });
    assert.equal(getResponse.statusCode, 404);
  });

  test('security: sem permission → 403', async () => {
    const [role] = await db
      .insert(roles)
      .values({ name: `Sem Perm Event Rules ${runId}`, slug: `test-no-event-rules-perm-${runId}`, isSystem: false })
      .returning();
    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-no-event-rules-perm-${runId}@example.com`;
    const [user] = await db.insert(users).values({ name: 'Sem Perm', email, passwordHash, roleId: role.id, isActive: true }).returning();
    const token = await login(email, 'senha-teste-12345');

    const response = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(token),
      payload: { name: 'x', eventType: 'crm.lead.created', jobId, filters: {} },
    });
    assert.equal(response.statusCode, 403);

    await db.delete(users).where(eq(users.id, user.id));
    await db.delete(roles).where(eq(roles.id, role.id));
  });

  test('security: payload com campo fora do schema (.strict()) é rejeitado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/event-rules',
      headers: authHeader(ceoToken),
      payload: { name: 'x', eventType: 'crm.lead.created', jobId, filters: {}, sql: 'DROP TABLE users;' },
    });
    assert.equal(response.statusCode, 400);
  });

  test('GET /agents/events/catalog devolve o catálogo fechado, sem duplicar no frontend', async () => {
    const response = await app.inject({ method: 'GET', url: '/agents/events/catalog', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);

    const catalog = response.json().data as Array<{ type: string; filterableFields: Record<string, string> }>;
    assert.ok(catalog.some((entry) => entry.type === 'crm.lead.created'));
    const leadEntry = catalog.find((entry) => entry.type === 'crm.lead.created')!;
    assert.ok('probability' in leadEntry.filterableFields);
  });
});
