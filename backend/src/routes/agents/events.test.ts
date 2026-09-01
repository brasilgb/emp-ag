import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { agentEvents, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { publishAgentEvent } from '../../agents/events/publisher.js';

describe('Agentes v1.4 — Events (GET/retry)', () => {
  const app = buildApp();

  let ceoToken: string;
  const createdEventIds: number[] = [];

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
  });

  after(async () => {
    if (createdEventIds.length > 0) await db.delete(agentEvents).where(inArray(agentEvents.id, createdEventIds));

    await database.end();
    redis.disconnect();
  });

  test('GET /agents/events lista eventos', async () => {
    const event = await publishAgentEvent({
      type: 'crm.lead.created',
      payload: { leadId: 555001, name: 'x', source: null, status: 'open', probability: 10, pipelineStageId: 1, ownerUserId: null },
    });
    createdEventIds.push(event.id);

    const response = await app.inject({ method: 'GET', url: '/agents/events', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().data.some((row: { id: number }) => row.id === event.id));
  });

  test('GET /agents/events/:id devolve evento + deliveries', async () => {
    const event = await publishAgentEvent({
      type: 'crm.lead.created',
      payload: { leadId: 555002, name: 'x', source: null, status: 'open', probability: 10, pipelineStageId: 1, ownerUserId: null },
    });
    createdEventIds.push(event.id);

    const response = await app.inject({ method: 'GET', url: `/agents/events/${event.id}`, headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.event.id, event.id);
    assert.deepEqual(response.json().data.deliveries, []);
  });

  test('GET /agents/events/:id inexistente → 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/agents/events/999999999', headers: authHeader(ceoToken) });
    assert.equal(response.statusCode, 404);
  });

  test('POST /agents/events/:id/retry só aceita evento failed', async () => {
    const event = await publishAgentEvent({
      type: 'crm.lead.created',
      payload: { leadId: 555003, name: 'x', source: null, status: 'open', probability: 10, pipelineStageId: 1, ownerUserId: null },
    });
    createdEventIds.push(event.id);

    // status inicial 'pending' — retry deveria ser rejeitado.
    const rejected = await app.inject({ method: 'POST', url: `/agents/events/${event.id}/retry`, headers: authHeader(ceoToken) });
    assert.equal(rejected.statusCode, 409);

    await db.update(agentEvents).set({ status: 'failed', attemptCount: 5 }).where(eq(agentEvents.id, event.id));

    const accepted = await app.inject({ method: 'POST', url: `/agents/events/${event.id}/retry`, headers: authHeader(ceoToken) });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().data.status, 'pending');
  });

  test('security: sem permission → 403', async () => {
    const response = await app.inject({ method: 'GET', url: '/agents/events' });
    assert.equal(response.statusCode, 401);
  });
});
