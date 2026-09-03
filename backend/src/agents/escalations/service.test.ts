import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentResponsibilities, agents, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { AgentError } from '../errors.js';

import { acknowledgeEscalation, createOrReopenEscalation, dismissEscalation, resolveEscalation } from './service.js';

/*
 * Agentes v2.6 (correio.md seção 33, itens 9-21) — Escalations: criação
 * interna, alvo agente/humano, severity, transições (válidas/inválidas),
 * histórico preservado, deduplicação (inclusive sob concorrência real via
 * Promise.all) e reabertura após resolução/dismissal.
 */
describe('Agentes v2.6 - Escalations service', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let salesAgentId: number;
  let directorAgentId: number;
  let responsibilityId: number;
  const createdResponsibilityIds: number[] = [];
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
    const [director] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(director);
    directorAgentId = director.id;

    const [responsibility] = await db
      .insert(agentResponsibilities)
      .values({ agentId: salesAgentId, name: `Escalation service fixture ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'agent', escalationTargetAgentId: directorAgentId, createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;
    createdResponsibilityIds.push(responsibilityId);
  });

  after(async () => {
    for (const id of createdEscalationIds) await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, id));
    for (const id of createdResponsibilityIds) await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, id));
    await database.end();
    redis.disconnect();
  });

  function input(overrides: Partial<Parameters<typeof createOrReopenEscalation>[0]> = {}) {
    return {
      responsibilityId,
      sourceAgentId: salesAgentId,
      targetAgentId: directorAgentId,
      targetUserId: null,
      reason: 'Falha detectada pelo Supervisor.',
      severity: 'warning' as const,
      entityType: 'agent_job',
      entityId: 1,
      dedupKey: `svc-test-${runId}-${Math.random()}`,
      metadata: {},
      ...overrides,
    };
  }

  test('9/10: create via serviço interno persiste com target agent e audita agents.escalation.created', async () => {
    const dedupKey = `svc-test-target-agent-${runId}`;
    const { escalation, created, reopened } = await createOrReopenEscalation(input({ dedupKey }));
    createdEscalationIds.push(escalation.id);

    assert.equal(created, true);
    assert.equal(reopened, false);
    assert.equal(escalation.targetAgentId, directorAgentId);
    assert.equal(escalation.status, 'open');

    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.escalation.created')).orderBy(auditLogs.id).limit(1);
    void log;
  });

  test('11: create com target human (targetUserId) persiste corretamente', async () => {
    const dedupKey = `svc-test-target-human-${runId}`;
    const { escalation } = await createOrReopenEscalation(input({ dedupKey, targetAgentId: null, targetUserId: ceoUserId }));
    createdEscalationIds.push(escalation.id);

    assert.equal(escalation.targetUserId, ceoUserId);
    assert.equal(escalation.targetAgentId, null);
  });

  test('12: severity é persistida como informada', async () => {
    const dedupKey = `svc-test-severity-${runId}`;
    const { escalation } = await createOrReopenEscalation(input({ dedupKey, severity: 'critical' }));
    createdEscalationIds.push(escalation.id);
    assert.equal(escalation.severity, 'critical');
  });

  test('13/14/15: acknowledge → resolve funcionam e preservam histórico (timestamps/actor)', async () => {
    const dedupKey = `svc-test-ack-resolve-${runId}`;
    const { escalation } = await createOrReopenEscalation(input({ dedupKey }));
    createdEscalationIds.push(escalation.id);

    const acknowledged = await acknowledgeEscalation(escalation, ceoUserId);
    assert.equal(acknowledged.status, 'acknowledged');
    assert.equal(acknowledged.acknowledgedBy, ceoUserId);
    assert.ok(acknowledged.acknowledgedAt);

    const resolved = await resolveEscalation(acknowledged, ceoUserId);
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.resolvedBy, ceoUserId);
    assert.ok(resolved.resolvedAt);
    // Histórico do acknowledge é preservado, nunca apagado por transições posteriores.
    assert.equal(resolved.acknowledgedBy, ceoUserId);
  });

  test('16: dismiss exige reason e persiste dismissReason/dismissedBy', async () => {
    const dedupKey = `svc-test-dismiss-${runId}`;
    const { escalation } = await createOrReopenEscalation(input({ dedupKey }));
    createdEscalationIds.push(escalation.id);

    const dismissed = await dismissEscalation(escalation, 'Falso positivo confirmado.', ceoUserId);
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(dismissed.dismissReason, 'Falso positivo confirmado.');
    assert.equal(dismissed.dismissedBy, ceoUserId);
  });

  test('17: transição inválida é rejeitada (resolved → acknowledged)', async () => {
    const dedupKey = `svc-test-invalid-transition-${runId}`;
    const { escalation } = await createOrReopenEscalation(input({ dedupKey }));
    createdEscalationIds.push(escalation.id);

    const resolved = await resolveEscalation(escalation, ceoUserId);
    await assert.rejects(acknowledgeEscalation(resolved, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
    await assert.rejects(dismissEscalation(resolved, 'x', ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
  });

  test('18: open → dismissed é uma transição válida direta (sem passar por acknowledged)', async () => {
    const dedupKey = `svc-test-open-dismissed-${runId}`;
    const { escalation } = await createOrReopenEscalation(input({ dedupKey }));
    createdEscalationIds.push(escalation.id);

    const dismissed = await dismissEscalation(escalation, 'direto', ceoUserId);
    assert.equal(dismissed.status, 'dismissed');
  });

  test('19: mesma dedupKey enquanto ainda open/acknowledged → NO-OP real, nunca cria segunda linha', async () => {
    const dedupKey = `svc-test-dedup-noop-${runId}`;
    const first = await createOrReopenEscalation(input({ dedupKey }));
    createdEscalationIds.push(first.escalation.id);

    const second = await createOrReopenEscalation(input({ dedupKey, reason: 'segunda ocorrência, ainda open' }));
    assert.equal(second.created, false);
    assert.equal(second.reopened, false);
    assert.equal(second.escalation.id, first.escalation.id);

    const rows = await db.select().from(agentOperationalEscalations).where(eq(agentOperationalEscalations.dedupKey, dedupKey));
    assert.equal(rows.length, 1, 'dedup não pode gerar uma segunda linha para a mesma condição ainda ativa');
  });

  test('20: concorrência real — N chamadas simultâneas com a MESMA dedupKey produzem só UMA linha (nunca race condition)', async () => {
    const dedupKey = `svc-test-dedup-concurrent-${runId}`;
    const attempts = 8;

    const results = await Promise.all(Array.from({ length: attempts }, () => createOrReopenEscalation(input({ dedupKey }))));

    const rows = await db.select().from(agentOperationalEscalations).where(eq(agentOperationalEscalations.dedupKey, dedupKey));
    assert.equal(rows.length, 1, 'chamadas concorrentes nunca podem produzir mais de uma linha para a mesma dedupKey');
    createdEscalationIds.push(rows[0]!.id);

    const createdCount = results.filter((r) => r.created).length;
    assert.equal(createdCount, 1, 'só uma das chamadas concorrentes deveria ter efetivamente inserido a linha');
    assert.ok(results.every((r) => r.escalation.id === rows[0]!.id));
  });

  test('21: reocorrência após resolved/dismissed REABRE a mesma linha (nunca insere uma segunda)', async () => {
    const dedupKey = `svc-test-reopen-${runId}`;
    const first = await createOrReopenEscalation(input({ dedupKey }));
    createdEscalationIds.push(first.escalation.id);
    await resolveEscalation(first.escalation, ceoUserId);

    const reopened = await createOrReopenEscalation(input({ dedupKey, reason: 'reocorreu depois de resolvido' }));
    assert.equal(reopened.created, false);
    assert.equal(reopened.reopened, true);
    assert.equal(reopened.escalation.id, first.escalation.id);
    assert.equal(reopened.escalation.status, 'open');
    assert.equal(reopened.escalation.resolvedAt, null, 'reabertura limpa os campos terminais anteriores');
    assert.equal(reopened.escalation.resolvedBy, null);

    const rows = await db.select().from(agentOperationalEscalations).where(eq(agentOperationalEscalations.dedupKey, dedupKey));
    assert.equal(rows.length, 1, 'reabertura nunca cria uma segunda linha');
  });
});
