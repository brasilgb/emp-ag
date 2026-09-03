import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentResponsibilities, agents, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { resolveOperationalResponsibility, resolvePrimaryResponsibility } from './ownership.js';

/*
 * Agentes v2.6 (correio.md seções 7/33 item 7) — resolução de ownership é
 * 100% determinística: só domain + enabled + priority, nunca LLM.
 * Responsibility desabilitada NUNCA aparece na resolução.
 */
describe('Agentes v2.6 - resolveOperationalResponsibility (ownership determinístico)', () => {
  const runId = Date.now() % 1_000_000;
  // varchar(20) na coluna domain — mantém curto o suficiente.
  const domain = `own-${runId}`;

  let ceoUserId: number;
  let salesAgentId: number;
  const createdIds: number[] = [];

  before(async () => {
    const ceoEmail = process.env.CEO_EMAIL;
    assert.ok(ceoEmail);
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    assert.ok(ceoUser);
    ceoUserId = ceoUser.id;

    const [sales] = await db.select().from(agents).where(eq(agents.slug, 'sales')).limit(1);
    assert.ok(sales);
    salesAgentId = sales.id;
  });

  after(async () => {
    for (const id of createdIds) await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, id));
    await database.end();
    redis.disconnect();
  });

  async function insertResponsibility(overrides: Partial<typeof agentResponsibilities.$inferInsert> = {}) {
    const [row] = await db
      .insert(agentResponsibilities)
      .values({
        agentId: salesAgentId,
        name: `Ownership ${runId}-${Math.random()}`,
        domain,
        responsibilityType: 'monitor',
        priority: 'medium',
        escalationPolicy: 'none',
        createdBy: ceoUserId,
        ...overrides,
      })
      .returning();
    createdIds.push(row!.id);
    return row!;
  }

  test('nenhuma responsibility para o domínio → lista vazia, primary null', async () => {
    const rows = await resolveOperationalResponsibility({ domain: `${domain}-vazio` });
    assert.equal(rows.length, 0);
    const primary = await resolvePrimaryResponsibility({ domain: `${domain}-vazio` });
    assert.equal(primary, null);
  });

  test('responsibility desabilitada nunca é retornada pela resolução', async () => {
    await insertResponsibility({ enabled: false, priority: 'critical' });
    const rows = await resolveOperationalResponsibility({ domain });
    assert.equal(rows.length, 0, 'responsibility desabilitada não deveria aparecer na resolução');
  });

  test('múltiplas responsibilities habilitadas: primary é a de maior prioridade (critical > high > medium > low)', async () => {
    const low = await insertResponsibility({ priority: 'low' });
    const critical = await insertResponsibility({ priority: 'critical' });
    const medium = await insertResponsibility({ priority: 'medium' });

    const primary = await resolvePrimaryResponsibility({ domain });
    assert.equal(primary!.id, critical.id);

    const all = await resolveOperationalResponsibility({ domain });
    assert.ok(all.length >= 3);
    void low;
    void medium;
  });

  test('filtro por responsibilityType restringe a resolução', async () => {
    await insertResponsibility({ responsibilityType: 'follow_up', priority: 'critical' });
    const rows = await resolveOperationalResponsibility({ domain, responsibilityType: 'follow_up' });
    assert.ok(rows.every((row) => row.responsibilityType === 'follow_up'));
  });
});
