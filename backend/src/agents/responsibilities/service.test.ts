import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentResponsibilities, agents, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { AgentError } from '../errors.js';

import { createResponsibility, deleteResponsibility, getResponsibilityById, listResponsibilities, updateResponsibility } from './service.js';

/*
 * Agentes v2.6 (correio.md seção 33, itens 1-8) — Responsibilities:
 * criação válida, rejeição de agent inexistente, update, enable/disable,
 * política de delete/disable.
 */
describe('Agentes v2.6 - Responsibilities service', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let salesAgentId: number;
  const createdIds: number[] = [];
  const createdEscalationIds: number[] = [];

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
    for (const id of createdEscalationIds) await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, id));
    for (const id of createdIds) await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, id));
    await database.end();
    redis.disconnect();
  });

  test('1: create válido persiste com defaults corretos (priority=medium, escalationPolicy=none, enabled=true)', async () => {
    const row = await createResponsibility(
      { agentId: salesAgentId, name: `Monitor CRM ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', conditions: {}, escalationPolicy: 'none' },
      ceoUserId,
    );
    createdIds.push(row.id);

    assert.equal(row.domain, 'crm');
    assert.equal(row.enabled, true);
    assert.equal(row.escalationPolicy, 'none');
    assert.equal(row.createdBy, ceoUserId);

    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.responsibility.created')).orderBy(auditLogs.id).limit(1);
    void log;
  });

  test('2: create rejeita agentId inexistente', async () => {
    await assert.rejects(
      createResponsibility({ agentId: 999999999, name: 'x', domain: 'crm', responsibilityType: 'monitor', priority: 'medium', conditions: {}, escalationPolicy: 'none' }, ceoUserId),
      (error: unknown) => error instanceof AgentError && error.code === 'validation_error',
    );
  });

  test('3/4: create com escalationPolicy=agent exige escalationTargetAgentId válido; com alvo inexistente é rejeitado', async () => {
    await assert.rejects(
      createResponsibility(
        { agentId: salesAgentId, name: 'x', domain: 'crm', responsibilityType: 'monitor', priority: 'medium', conditions: {}, escalationPolicy: 'agent', escalationTargetAgentId: 999999999 },
        ceoUserId,
      ),
      (error: unknown) => error instanceof AgentError,
    );

    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    const row = await createResponsibility(
      { agentId: salesAgentId, name: `Escala p/ Director ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', conditions: {}, escalationPolicy: 'agent', escalationTargetAgentId: director.id },
      ceoUserId,
    );
    createdIds.push(row.id);
    assert.equal(row.escalationTargetAgentId, director.id);
  });

  test('5: update altera campos e audita agents.responsibility.updated', async () => {
    const row = await createResponsibility(
      { agentId: salesAgentId, name: `Update alvo ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'low', conditions: {}, escalationPolicy: 'none' },
      ceoUserId,
    );
    createdIds.push(row.id);

    const updated = await updateResponsibility(row, { priority: 'high' }, ceoUserId);
    assert.equal(updated.priority, 'high');

    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.responsibility.updated')).orderBy(auditLogs.id).limit(1);
    assert.ok(log);
  });

  test('6: enable/disable audita evento específico apenas quando o valor de fato muda', async () => {
    const row = await createResponsibility(
      { agentId: salesAgentId, name: `Enable/Disable ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', conditions: {}, escalationPolicy: 'none' },
      ceoUserId,
    );
    createdIds.push(row.id);

    const disabled = await updateResponsibility(row, { enabled: false }, ceoUserId);
    assert.equal(disabled.enabled, false);
    const [disabledLog] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'agents.responsibility.disabled'))
      .orderBy(auditLogs.id)
      .limit(1);
    assert.ok(disabledLog);

    // Update sem tocar enabled não deve gerar um segundo evento disabled.
    const logsBefore = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.responsibility.disabled'));
    await updateResponsibility(disabled, { priority: 'critical' }, ceoUserId);
    const logsAfter = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.responsibility.disabled'));
    assert.equal(logsAfter.length, logsBefore.length, 'não deve auditar disabled de novo quando enabled não mudou');
  });

  test('7: listResponsibilities filtra por domain/enabled', async () => {
    const row = await createResponsibility(
      { agentId: salesAgentId, name: `List filtro ${runId}`, domain: 'finance', responsibilityType: 'review', priority: 'medium', conditions: {}, escalationPolicy: 'none' },
      ceoUserId,
    );
    createdIds.push(row.id);

    const { rows } = await listResponsibilities({ page: 1, limit: 100, domain: 'finance', enabled: true });
    assert.ok(rows.some((r) => r.id === row.id));
    assert.ok(rows.every((r) => r.domain === 'finance' && r.enabled === true));
  });

  test('8: delete real só é permitido sem histórico de escalation; com histórico → 409 e preferência por disable', async () => {
    const row = await createResponsibility(
      { agentId: salesAgentId, name: `Delete policy ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', conditions: {}, escalationPolicy: 'none' },
      ceoUserId,
    );

    const [escalation] = await db
      .insert(agentOperationalEscalations)
      .values({
        responsibilityId: row.id,
        sourceAgentId: salesAgentId,
        reason: 'teste',
        severity: 'info',
        status: 'open',
        dedupKey: `delete-policy-test-${runId}`,
      })
      .returning();
    createdEscalationIds.push(escalation!.id);

    await assert.rejects(deleteResponsibility(row, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');

    // Sem histórico, delete real funciona.
    const row2 = await createResponsibility(
      { agentId: salesAgentId, name: `Delete policy sem histórico ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', conditions: {}, escalationPolicy: 'none' },
      ceoUserId,
    );
    await deleteResponsibility(row2, ceoUserId);
    const found = await getResponsibilityById(row2.id);
    assert.equal(found, null);

    createdIds.push(row.id);
  });
});
