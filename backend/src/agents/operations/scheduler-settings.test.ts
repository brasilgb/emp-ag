import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { settings } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { isOperationalSupervisionEnabled, OPERATIONAL_SUPERVISION_SETTING_KEY, setOperationalSupervisionEnabled } from './scheduler-settings.js';

/*
 * Agentes v2.5.1 (correio.md seção 34, "configuração") — itens 18/19/21:
 * default seguro, round-trip persistido, mesma tabela `settings` do
 * kill switch v1.3.
 */
describe('Agentes v2.5.1 - scheduler-settings (setting persistido)', () => {
  after(async () => {
    await db.delete(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY));
    await database.end();
    redis.disconnect();
  });

  test('18: default (nenhum setting persistido ainda) é seguro — false', async () => {
    await db.delete(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY));
    const enabled = await isOperationalSupervisionEnabled();
    assert.equal(enabled, false);
  });

  test('19/21: setOperationalSupervisionEnabled(true) persiste e é lido de volta corretamente; toggle para false também', async () => {
    await setOperationalSupervisionEnabled(true);
    assert.equal(await isOperationalSupervisionEnabled(), true);

    await setOperationalSupervisionEnabled(false);
    assert.equal(await isOperationalSupervisionEnabled(), false);
  });

  test('chamadas repetidas fazem UPDATE, nunca inserem uma segunda linha', async () => {
    await setOperationalSupervisionEnabled(true);
    await setOperationalSupervisionEnabled(true);
    await setOperationalSupervisionEnabled(false);

    const rows = await db.select().from(settings).where(eq(settings.key, OPERATIONAL_SUPERVISION_SETTING_KEY));
    assert.equal(rows.length, 1);
  });
});
