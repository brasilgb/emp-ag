import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EVENT_CATALOG, getEventDefinition, isEventType } from './catalog.js';

describe('Event Catalog (Agentes v1.4 — correio.md seção 3)', () => {
  test('aceita event type existente', () => {
    assert.ok(isEventType('crm.lead.created'));
    assert.equal(getEventDefinition('crm.lead.created')?.version, 1);
  });

  test('rejeita event type desconhecido', () => {
    assert.equal(isEventType('crm.lead.deleted'), false);
    assert.equal(getEventDefinition('crm.lead.deleted'), undefined);
  });

  test('cada evento do catálogo tem payloadSchema .strict() (rejeita campo extra)', () => {
    for (const definition of Object.values(EVENT_CATALOG)) {
      const parsed = definition.payloadSchema.safeParse({ __campo_inventado__: true });
      assert.equal(parsed.success, false, `${definition.type} deveria rejeitar payload com campo desconhecido.`);
    }
  });

  test('rejeita payload inválido (campo obrigatório ausente)', () => {
    const definition = getEventDefinition('crm.lead.created')!;
    const parsed = definition.payloadSchema.safeParse({ leadId: 1 });
    assert.equal(parsed.success, false);
  });

  test('filterableFields nunca referencia um campo fora do payloadSchema', () => {
    for (const definition of Object.values(EVENT_CATALOG)) {
      const shape = (definition.payloadSchema as unknown as { shape: Record<string, unknown> }).shape;

      for (const field of Object.keys(definition.filterableFields)) {
        assert.ok(field in shape, `${definition.type}: campo filtrável "${field}" não existe no payloadSchema.`);
      }
    }
  });
});
