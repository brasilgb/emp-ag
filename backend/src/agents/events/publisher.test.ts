import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentEvents } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { runWithLineage } from '../autonomy/lineage-context.js';
import { publishAgentEvent } from './publisher.js';

describe('publishAgentEvent (Agentes v1.4 — correio.md seções 8/9)', () => {
  const createdEventIds: number[] = [];

  after(async () => {
    if (createdEventIds.length > 0) {
      const { inArray } = await import('drizzle-orm');
      await db.delete(agentEvents).where(inArray(agentEvents.id, createdEventIds));
    }

    await database.end();
    redis.disconnect();
  });

  test('persiste evento com payload validado e aggregate metadata preservado', async () => {
    const event = await publishAgentEvent({
      type: 'crm.lead.created',
      aggregateType: 'crm.lead',
      aggregateId: 42,
      source: 'test',
      payload: { leadId: 42, name: 'Lead teste', source: 'referral', status: 'open', probability: 80, pipelineStageId: 1, ownerUserId: null },
    });
    createdEventIds.push(event.id);

    assert.equal(event.eventType, 'crm.lead.created');
    assert.equal(event.eventVersion, 1);
    assert.equal(event.aggregateType, 'crm.lead');
    assert.equal(event.aggregateId, '42');
    assert.equal(event.status, 'pending');

    const [reloaded] = await db.select().from(agentEvents).where(eq(agentEvents.id, event.id));
    assert.deepEqual(reloaded.payload, {
      leadId: 42,
      name: 'Lead teste',
      source: 'referral',
      status: 'open',
      probability: 80,
      pipelineStageId: 1,
      ownerUserId: null,
    });
  });

  test('rejeita tipo de evento fora do catálogo', async () => {
    await assert.rejects(() => publishAgentEvent({ type: 'crm.lead.deleted', payload: {} }));
  });

  test('rejeita payload inválido (campo obrigatório ausente)', async () => {
    await assert.rejects(() => publishAgentEvent({ type: 'crm.lead.created', payload: { leadId: 1 } }));
  });

  test('rejeita payload com campo fora do schema (.strict())', async () => {
    await assert.rejects(() =>
      publishAgentEvent({
        type: 'crm.lead.created',
        payload: {
          leadId: 1,
          name: 'x',
          source: null,
          status: 'open',
          probability: 50,
          pipelineStageId: 1,
          ownerUserId: null,
          sql: 'DROP TABLE users;',
        },
      }),
    );
  });

  test('gera idempotency key e evento duplicado não duplica processamento (mesma linha devolvida)', async () => {
    const idempotencyKey = `test-publisher-${Date.now()}`;

    const first = await publishAgentEvent({
      type: 'crm.client.created',
      idempotencyKey,
      payload: { clientId: 1, type: 'company', name: 'Cliente teste', status: 'active' },
    });
    createdEventIds.push(first.id);

    const second = await publishAgentEvent({
      type: 'crm.client.created',
      idempotencyKey,
      payload: { clientId: 1, type: 'company', name: 'Cliente teste', status: 'active' },
    });

    assert.equal(second.id, first.id);

    const all = await db.select().from(agentEvents).where(eq(agentEvents.idempotencyKey, idempotencyKey));
    assert.equal(all.length, 1, 'idempotencyKey repetida não deveria criar uma segunda linha.');
  });

  test('Agentes v1.5 (seção 13/14): fora de um contexto de lineage, o evento nunca recebe lineage falsa', async () => {
    const event = await publishAgentEvent({
      type: 'crm.client.created',
      payload: { clientId: 2, type: 'individual', name: 'Cliente sem lineage', status: 'active' },
    });
    createdEventIds.push(event.id);

    assert.equal(event.causedByRunId, null);
    assert.equal(event.rootExecutionId, null);
    assert.equal(event.autonomyDepth, null);
  });

  test('Agentes v1.5 (seção 13): dentro de runWithLineage, o evento é carimbado com a causa real', async () => {
    const event = await runWithLineage({ rootExecutionId: 777, causationRunId: 778, autonomyDepth: 2 }, () =>
      publishAgentEvent({
        type: 'crm.client.created',
        payload: { clientId: 3, type: 'individual', name: 'Cliente causado por agente', status: 'active' },
      }),
    );
    createdEventIds.push(event.id);

    assert.equal(event.causedByRunId, 778);
    assert.equal(event.rootExecutionId, 777);
    assert.equal(event.autonomyDepth, 2);
  });
});
