import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { auditLogs, settings, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { DEFAULT_SLA_MINUTES_BY_SEVERITY, SLA_SETTING_KEY, getOperationalSlaMinutesBySeverity, setOperationalSlaMinutesBySeverity } from './sla-settings.js';

/**
 * Agentes v4.1 (correio.md "Operational Incident Aging & SLA
 * Visibility") — `sla-settings.ts` reaproveita a tabela genérica
 * `settings` (nenhuma migration) — testa get/set/validação/auditoria
 * isoladamente do resto do módulo de Operations.
 */
describe('Agentes v4.1 - sla-settings (getOperationalSlaMinutesBySeverity/setOperationalSlaMinutesBySeverity)', () => {
  let ceoUserId: number;
  let hadPreexistingRow = false;
  let originalValue: unknown = null;

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    // Preserva o estado real (pode já existir de uma execução anterior
    // da suíte) para restaurar no after() — nunca deixar a config global
    // poluída para outros testes/ambientes.
    const [existing] = await db.select().from(settings).where(eq(settings.key, SLA_SETTING_KEY)).limit(1);
    if (existing) {
      hadPreexistingRow = true;
      originalValue = existing.value;
    }
  });

  after(async () => {
    if (hadPreexistingRow) {
      await db.update(settings).set({ value: originalValue }).where(eq(settings.key, SLA_SETTING_KEY));
    } else {
      await db.delete(settings).where(eq(settings.key, SLA_SETTING_KEY));
    }
    await database.end();
    redis.disconnect();
  });

  test('sem override persistido, devolve os defaults documentados (alinhados a AGING_BUCKETS)', async () => {
    await db.delete(settings).where(eq(settings.key, SLA_SETTING_KEY));
    const value = await getOperationalSlaMinutesBySeverity();
    assert.deepEqual(value, DEFAULT_SLA_MINUTES_BY_SEVERITY);
  });

  test('atualização parcial altera só a severidade informada, preservando as demais', async () => {
    await db.delete(settings).where(eq(settings.key, SLA_SETTING_KEY));

    const first = await setOperationalSlaMinutesBySeverity({ critical: 30 }, ceoUserId);
    assert.ok(first.ok);
    assert.equal(first.value.critical, 30);
    assert.equal(first.value.warning, DEFAULT_SLA_MINUTES_BY_SEVERITY.warning);
    assert.equal(first.value.info, DEFAULT_SLA_MINUTES_BY_SEVERITY.info);

    const second = await setOperationalSlaMinutesBySeverity({ warning: 180 }, ceoUserId);
    assert.ok(second.ok);
    assert.equal(second.value.critical, 30, 'a alteração anterior (critical=30) deveria ter sido preservada');
    assert.equal(second.value.warning, 180);

    const read = await getOperationalSlaMinutesBySeverity();
    assert.deepEqual(read, second.value);
  });

  test('rejeita valores inválidos (não inteiro, fora da faixa) sem alterar o estado persistido', async () => {
    await setOperationalSlaMinutesBySeverity({ critical: 45 }, ceoUserId);

    const rejectedZero = await setOperationalSlaMinutesBySeverity({ critical: 0 }, ceoUserId);
    assert.deepEqual(rejectedZero, { ok: false, message: 'critical: Cada valor de SLA deve estar entre 1 e 43200 minutos (30 dias).' });

    const rejectedTooLarge = await setOperationalSlaMinutesBySeverity({ warning: 999999 }, ceoUserId);
    assert.equal(rejectedTooLarge.ok, false);

    const rejectedFloat = await setOperationalSlaMinutesBySeverity({ info: 1.5 }, ceoUserId);
    assert.equal(rejectedFloat.ok, false);

    const stillUnchanged = await getOperationalSlaMinutesBySeverity();
    assert.equal(stillUnchanged.critical, 45, 'valores rejeitados nunca deveriam ter sido persistidos');
  });

  test('cada alteração bem-sucedida grava exatamente um audit log com ator/valor anterior/valor novo', async () => {
    await db.delete(settings).where(eq(settings.key, SLA_SETTING_KEY));

    const before1 = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'agents.operations.sla_settings.updated'));

    await setOperationalSlaMinutesBySeverity({ critical: 15 }, ceoUserId);

    const after1 = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.operations.sla_settings.updated')).orderBy(auditLogs.id);
    assert.equal(after1.length, before1.length + 1, 'exatamente um audit novo por chamada bem-sucedida');

    const latest = after1[after1.length - 1]!;
    assert.equal(latest.userId, ceoUserId);
    const metadata = latest.metadata as { previous: unknown; next: { critical: number } };
    assert.equal(metadata.next.critical, 15);
    assert.ok(metadata.previous, 'valor anterior deveria estar presente no audit');

    // Tentativa rejeitada NUNCA deveria gerar um audit novo.
    await setOperationalSlaMinutesBySeverity({ critical: -1 }, ceoUserId);
    const afterRejected = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.action, 'agents.operations.sla_settings.updated'));
    assert.equal(afterRejected.length, after1.length, 'nenhum audit novo deveria ter sido gravado por uma alteração rejeitada');
  });
});
