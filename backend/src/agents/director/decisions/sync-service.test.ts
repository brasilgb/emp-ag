import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { db } from '../../../db/index.js';
import { agentDirectorDecisions } from '../../../db/schema/index.js';
import { database } from '../../../services/database.js';
import { redis } from '../../../services/redis.js';
import type { OperationalSignal, SignalDomain } from '../types.js';

import { buildDeduplicationKey } from './dedup.js';
import { syncDirectorDecisionQueue } from './sync-service.js';

/*
 * Agentes v1.9 (correio.md secao 32 "Detection / sync") - injeta
 * coletores fake (mesmo padrao de operations-service.test.ts na v1.8):
 * testa a logica de sincronizacao/dedup/recorrencia/resolucao/
 * concorrencia sem depender de fixtures reais em 4 modulos de negocio.
 */
function fakeSignal(overrides: Partial<OperationalSignal> = {}): OperationalSignal {
  return {
    id: 'fake:1',
    type: 'crm.lead_follow_up_overdue',
    domain: 'crm',
    severity: 'warning',
    title: 'Sinal fake',
    description: 'Descrição fake.',
    entityType: 'lead',
    entityId: 999001,
    detectedAt: new Date('2026-06-15T12:00:00.000Z'),
    metadata: {},
    ...overrides,
  };
}

function fakeCollector(domain: SignalDomain, signals: OperationalSignal[]) {
  return { domain, collect: async () => signals };
}

function failingCollector(domain: SignalDomain) {
  return {
    domain,
    collect: async () => {
      throw new Error('fonte indisponível');
    },
  };
}

function emptyCollectors(overrides: Partial<Record<SignalDomain, OperationalSignal[]>> = {}) {
  const domains: SignalDomain[] = ['crm', 'projects', 'finance', 'support', 'agents'];
  return domains.map((domain) => fakeCollector(domain, overrides[domain] ?? []));
}

const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('Agentes v1.9 - syncDirectorDecisionQueue', () => {
  // entityId é uma coluna `integer` real (mesma faixa de ids de negócio
  // de verdade) — nunca Date.now() puro (~13 dígitos, estoura o range de
  // integer do Postgres). Um resto pequeno ainda garante isolamento
  // suficiente entre execuções concorrentes de teste no mesmo banco.
  const runId = Date.now() % 1_000_000;
  const touchedDedupKeys: string[] = [];

  afterEach(async () => {
    if (touchedDedupKeys.length > 0) {
      await db.delete(agentDirectorDecisions).where(inArray(agentDirectorDecisions.deduplicationKey, touchedDedupKeys));
      touchedDedupKeys.length = 0;
    }
  });

  after(async () => {
    await database.end();
    redis.disconnect();
  });

  test('cria item a partir de signal', async () => {
    const entityId = runId + 1;
    const signal = fakeSignal({ entityId, id: `x:${runId}` });
    touchedDedupKeys.push(buildDeduplicationKey(signal));
    const summary = await syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] }));

    assert.equal(summary.created, 1);
    assert.equal(summary.errors.length, 0);

    const [row] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));
    assert.ok(row);
    assert.equal(row.status, 'open');
    assert.equal(row.occurrenceCount, 1);
    assert.equal(row.firstDetectedAt.getTime(), NOW.getTime());
  });

  test('não duplica na próxima coleta (mesma entidade) — incrementa recurrence, atualiza lastDetectedAt, mantém firstDetectedAt', async () => {
    const entityId = runId + 2;
    const signal = fakeSignal({ entityId, id: `x:${runId}` });
    touchedDedupKeys.push(buildDeduplicationKey(signal));

    const first = await syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] }));
    assert.equal(first.created, 1);

    const laterNow = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    const second = await syncDirectorDecisionQueue(laterNow, emptyCollectors({ crm: [signal] }));
    assert.equal(second.created, 0, 'a segunda sincronização nunca deve criar um segundo item para a mesma entidade.');
    assert.ok(second.updated + second.unchanged >= 1);

    const rows = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));
    assert.equal(rows.length, 1, 'nunca deveria existir mais de uma linha para a mesma dedup key.');
    assert.equal(rows[0].occurrenceCount, 2);
    assert.equal(rows[0].firstDetectedAt.getTime(), NOW.getTime(), 'firstDetectedAt nunca deve mudar numa reocorrência.');
    assert.equal(rows[0].lastDetectedAt.getTime(), laterNow.getTime());
  });

  test('resolve quando o sinal desaparece (domínio sem erro)', async () => {
    const entityId = runId + 3;
    const signal = fakeSignal({ entityId, id: `x:${runId}` });
    touchedDedupKeys.push(buildDeduplicationKey(signal));

    await syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] }));

    const laterNow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const summary = await syncDirectorDecisionQueue(laterNow, emptyCollectors());
    assert.equal(summary.resolved, 1);

    const [row] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));
    assert.equal(row.status, 'resolved');
    assert.ok(row.resolvedAt);
  });

  test('NÃO resolve quando o domínio falha na coleta — item preservado intocado', async () => {
    const entityId = runId + 4;
    const signal = fakeSignal({ entityId, id: `x:${runId}` });
    touchedDedupKeys.push(buildDeduplicationKey(signal));

    await syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] }));

    const laterNow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const collectorsWithCrmFailing = [
      failingCollector('crm'),
      fakeCollector('projects', []),
      fakeCollector('finance', []),
      fakeCollector('support', []),
      fakeCollector('agents', []),
    ];
    const summary = await syncDirectorDecisionQueue(laterNow, collectorsWithCrmFailing);

    assert.equal(summary.resolved, 0, 'nenhum item de um domínio que falhou pode ser resolvido nesta chamada.');
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].domain, 'crm');

    const [row] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));
    assert.equal(row.status, 'open', 'item preservado exatamente como estava.');
  });

  test('item resolvido reabre quando a condição reaparece (correio.md seção 6/17)', async () => {
    const entityId = runId + 5;
    const signal = fakeSignal({ entityId, id: `x:${runId}` });
    touchedDedupKeys.push(buildDeduplicationKey(signal));

    await syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] }));
    const laterNow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    await syncDirectorDecisionQueue(laterNow, emptyCollectors()); // resolve

    const [resolved] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));
    assert.equal(resolved.status, 'resolved');

    const evenLaterNow = new Date(laterNow.getTime() + 24 * 60 * 60 * 1000);
    await syncDirectorDecisionQueue(evenLaterNow, emptyCollectors({ crm: [signal] })); // reaparece

    const [reopened] = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.resolvedAt, null);
    // create (1) -> resolve (não toca occurrenceCount, continua 1) ->
    // reaparece (incrementa para 2).
    assert.equal(reopened.occurrenceCount, 2, 'a reabertura ainda conta como mais uma ocorrência.');
  });

  test('reprocessamento idempotente: mesma chamada de sync duas vezes seguidas não duplica nem incrementa demais', async () => {
    const entityId = runId + 6;
    const signal = fakeSignal({ entityId, id: `x:${runId}` });
    touchedDedupKeys.push(buildDeduplicationKey(signal));

    await syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] }));
    const summary = await syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] }));

    const rows = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].occurrenceCount, 2, 'rodar sync de novo com o mesmo now ainda representa uma nova detecção real, incrementa 1x.');
    assert.equal(summary.created, 0);
  });

  test('concorrência: duas sincronizações simultâneas para o mesmo sinal nunca criam item duplicado', async () => {
    const entityId = runId + 7;
    const signal = fakeSignal({ entityId, id: `x:${runId}` });
    touchedDedupKeys.push(buildDeduplicationKey(signal));

    const [resultA, resultB] = await Promise.all([
      syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] })),
      syncDirectorDecisionQueue(NOW, emptyCollectors({ crm: [signal] })),
    ]);

    const rows = await db
      .select()
      .from(agentDirectorDecisions)
      .where(eq(agentDirectorDecisions.deduplicationKey, buildDeduplicationKey(signal)));

    assert.equal(rows.length, 1, 'duas sincronizações concorrentes nunca podem criar duas linhas para o mesmo dedup key.');
    assert.equal(rows[0].occurrenceCount, 2, 'ambas as tentativas devem contar — uma como created, outra como update, sem perder incremento.');
    assert.equal(resultA.created + resultB.created, 1);
  });
});
