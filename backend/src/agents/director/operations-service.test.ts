import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getDailyOperationsBrief } from './operations-service.js';
import type { OperationalSignal, SignalDomain } from './types.js';

/*
 * Agentes v1.8 (correio.md secao 20) - Brief: consolidacao, contadores,
 * modulos vazios, falha isolada de uma fonte sem corromper
 * silenciosamente dados. Usa a injecao de dependencia de
 * collectOperationalSignals (via getDailyOperationsBrief) para nunca
 * depender do estado real do banco compartilhado — determinístico e
 * isolado de outros arquivos de teste.
 */
function fakeSignal(overrides: Partial<OperationalSignal> = {}): OperationalSignal {
  return {
    id: 'fake:1',
    type: 'fake.signal',
    domain: 'crm',
    severity: 'warning',
    title: 'Sinal fake',
    description: 'Descrição fake.',
    detectedAt: new Date('2026-06-15T12:00:00.000Z'),
    metadata: {},
    ...overrides,
  };
}

function fakeCollector(domain: SignalDomain, signals: OperationalSignal[]) {
  return { domain, collect: async () => signals };
}

function failingCollector(domain: SignalDomain, message: string) {
  return { domain, collect: async () => { throw new Error(message); } };
}

const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('Agentes v1.8 - Director Operations Service (brief)', () => {
  test('consolidação correta: agrupa por domínio, mantém tudo que os coletores retornaram', async () => {
    const collectors = [
      fakeCollector('crm', [fakeSignal({ id: 'crm:1', domain: 'crm', severity: 'warning' })]),
      fakeCollector('projects', [fakeSignal({ id: 'projects:1', domain: 'projects', severity: 'critical' })]),
      fakeCollector('finance', []),
      fakeCollector('support', []),
      fakeCollector('agents', []),
    ];

    const brief = await getDailyOperationsBrief(NOW, collectors);

    assert.equal(brief.status, 'ok');
    assert.deepEqual(brief.errors, []);
    assert.equal(brief.domains.crm.length, 1);
    assert.equal(brief.domains.projects.length, 1);
    assert.equal(brief.domains.crm[0].id, 'crm:1');
  });

  test('contadores refletem exatamente a severidade dos sinais retornados', async () => {
    const collectors = [
      fakeCollector('crm', [
        fakeSignal({ id: 'a', severity: 'critical' }),
        fakeSignal({ id: 'b', severity: 'critical' }),
        fakeSignal({ id: 'c', severity: 'warning' }),
      ]),
      fakeCollector('projects', [fakeSignal({ id: 'd', domain: 'projects', severity: 'attention' })]),
      fakeCollector('finance', []),
      fakeCollector('support', []),
      fakeCollector('agents', []),
    ];

    const brief = await getDailyOperationsBrief(NOW, collectors);

    assert.equal(brief.summary.critical, 2);
    assert.equal(brief.summary.warning, 1);
    assert.equal(brief.summary.attention, 1);
    assert.equal(brief.summary.info, 0);
  });

  test('módulos vazios: domínio sem sinais retorna array vazio, não erro', async () => {
    const collectors = [
      fakeCollector('crm', []),
      fakeCollector('projects', []),
      fakeCollector('finance', []),
      fakeCollector('support', []),
      fakeCollector('agents', []),
    ];

    const brief = await getDailyOperationsBrief(NOW, collectors);

    assert.equal(brief.status, 'ok');
    assert.deepEqual(brief.domains.crm, []);
    assert.deepEqual(brief.domains.finance, []);
  });

  test('falha isolada de uma fonte: status "partial" com erro explícito, demais domínios intactos (nunca [] mascarando erro)', async () => {
    const collectors = [
      fakeCollector('crm', [fakeSignal({ id: 'crm:1' })]),
      fakeCollector('projects', [fakeSignal({ id: 'projects:1', domain: 'projects' })]),
      failingCollector('finance', 'conexão com o banco falhou'),
      fakeCollector('support', []),
      fakeCollector('agents', []),
    ];

    const brief = await getDailyOperationsBrief(NOW, collectors);

    assert.equal(brief.status, 'partial');
    assert.equal(brief.errors.length, 1);
    assert.equal(brief.errors[0].domain, 'finance');
    assert.equal(brief.errors[0].code, 'SOURCE_UNAVAILABLE');
    // Os domínios que funcionaram continuam íntegros — a falha de
    // 'finance' nunca contamina 'crm'/'projects'.
    assert.equal(brief.domains.crm.length, 1);
    assert.equal(brief.domains.projects.length, 1);
    assert.deepEqual(brief.domains.finance, []);
  });

  test('generatedAt reflete o `now` recebido, nunca o relógio real do processo', async () => {
    const brief = await getDailyOperationsBrief(NOW, [
      fakeCollector('crm', []),
      fakeCollector('projects', []),
      fakeCollector('finance', []),
      fakeCollector('support', []),
      fakeCollector('agents', []),
    ]);

    assert.equal(brief.generatedAt, NOW.toISOString());
  });
});
