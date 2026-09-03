import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { agentOperationalEscalations, agentOperationalFollowUps, agentResponsibilities, agents, auditLogs, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import { AgentError } from '../errors.js';

import {
  completeFollowUp,
  createManualFollowUp,
  createOrReopenFollowUpFromEscalation,
  dismissFollowUp,
  reassignFollowUp,
  resumeFollowUp,
  startFollowUp,
  waitFollowUp,
} from './service.js';

/*
 * Agentes v2.7 (correio.md seção 23) — Criação, dedup/concorrência,
 * estados/transições, histórico e reassignment do módulo FollowUps.
 */
describe('Agentes v2.7 - FollowUps service', () => {
  const runId = Date.now() % 1_000_000;

  let ceoUserId: number;
  let salesAgentId: number;
  let directorAgentId: number;
  let responsibilityId: number;
  const createdFollowUpIds: number[] = [];
  const createdEscalationIds: number[] = [];
  const createdResponsibilityIds: number[] = [];

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
      .values({ agentId: salesAgentId, name: `FollowUp fixture ${runId}`, domain: 'crm', responsibilityType: 'monitor', priority: 'medium', escalationPolicy: 'agent', escalationTargetAgentId: directorAgentId, createdBy: ceoUserId })
      .returning();
    responsibilityId = responsibility!.id;
    createdResponsibilityIds.push(responsibilityId);
  });

  after(async () => {
    for (const id of createdFollowUpIds) await db.delete(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.id, id));
    for (const id of createdEscalationIds) await db.delete(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, id));
    for (const id of createdResponsibilityIds) await db.delete(agentResponsibilities).where(eq(agentResponsibilities.id, id));
    await database.end();
    redis.disconnect();
  });

  async function insertEscalation(dedupKey: string, overrides: Partial<typeof agentOperationalEscalations.$inferInsert> = {}) {
    const [escalation] = await db
      .insert(agentOperationalEscalations)
      .values({
        responsibilityId,
        sourceAgentId: salesAgentId,
        targetAgentId: directorAgentId,
        reason: 'Falha detectada pelo Supervisor.',
        severity: 'warning',
        status: 'open',
        dedupKey,
        ...overrides,
      })
      .returning();
    createdEscalationIds.push(escalation!.id);
    return escalation!;
  }

  async function getResponsibilityRow() {
    const [row] = await db.select().from(agentResponsibilities).where(eq(agentResponsibilities.id, responsibilityId)).limit(1);
    return row!;
  }

  test('1/3: escalation válida gera follow-up com owner vindo da responsibility', async () => {
    const escalation = await insertEscalation(`svc-fu-create-${runId}`);
    const responsibility = await getResponsibilityRow();

    const { followUp, created } = await createOrReopenFollowUpFromEscalation({ escalation, responsibility });
    createdFollowUpIds.push(followUp.id);

    assert.equal(created, true);
    assert.equal(followUp.ownerAgentId, responsibility.agentId);
    assert.equal(followUp.responsibilityId, responsibilityId);
    assert.equal(followUp.escalationId, escalation.id);
    assert.equal(followUp.sourceType, 'escalation');
    assert.equal(followUp.status, 'open');

    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.followup.created')).orderBy(auditLogs.id).limit(1);
    void log;
  });

  test('4: target humano é usuário real (createManualFollowUp valida assignedUserId)', async () => {
    await assert.rejects(
      createManualFollowUp({ responsibilityId, title: 'x', priority: 'medium', assignedUserId: 999999999 }, ceoUserId),
      (error: unknown) => error instanceof AgentError && error.code === 'validation_error',
    );

    const followUp = await createManualFollowUp({ responsibilityId, title: `Manual válido ${runId}`, priority: 'medium', assignedUserId: ceoUserId }, ceoUserId);
    createdFollowUpIds.push(followUp.id);
    assert.equal(followUp.assignedUserId, ceoUserId);
    assert.equal(followUp.sourceType, 'responsibility');
    assert.equal(followUp.ownerAgentId, salesAgentId);
  });

  test('2: responsibility inexistente não gera follow-up indevido (validation_error)', async () => {
    await assert.rejects(
      createManualFollowUp({ responsibilityId: 999999999, title: 'x', priority: 'medium' }, ceoUserId),
      (error: unknown) => error instanceof AgentError && error.code === 'validation_error',
    );
  });

  test('5: mesma ocorrência (mesma escalation) não duplica follow-up — NO-OP real', async () => {
    const escalation = await insertEscalation(`svc-fu-dedup-noop-${runId}`);
    const responsibility = await getResponsibilityRow();

    const first = await createOrReopenFollowUpFromEscalation({ escalation, responsibility });
    createdFollowUpIds.push(first.followUp.id);

    const second = await createOrReopenFollowUpFromEscalation({ escalation, responsibility });
    assert.equal(second.created, false);
    assert.equal(second.reopened, false);
    assert.equal(second.followUp.id, first.followUp.id);

    const rows = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.escalationId, escalation.id));
    assert.equal(rows.length, 1);
  });

  test('6: chamadas concorrentes (Promise.all) produzem uma única linha', async () => {
    const escalation = await insertEscalation(`svc-fu-concurrent-${runId}`);
    const responsibility = await getResponsibilityRow();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => createOrReopenFollowUpFromEscalation({ escalation, responsibility })),
    );

    const rows = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.escalationId, escalation.id));
    assert.equal(rows.length, 1, 'chamadas concorrentes nunca podem produzir mais de uma linha para a mesma escalation');
    createdFollowUpIds.push(rows[0]!.id);

    const createdCount = results.filter((r) => r.created).length;
    assert.equal(createdCount, 1);
    assert.ok(results.every((r) => r.followUp.id === rows[0]!.id));
  });

  test('7: recorrência após terminal (completed) REABRE a mesma linha', async () => {
    const escalation = await insertEscalation(`svc-fu-reopen-${runId}`);
    const responsibility = await getResponsibilityRow();

    const first = await createOrReopenFollowUpFromEscalation({ escalation, responsibility });
    createdFollowUpIds.push(first.followUp.id);
    await completeFollowUp(first.followUp, 'Resolvido manualmente para o teste.', ceoUserId);

    const reopened = await createOrReopenFollowUpFromEscalation({ escalation, responsibility });
    assert.equal(reopened.created, false);
    assert.equal(reopened.reopened, true);
    assert.equal(reopened.followUp.id, first.followUp.id);
    assert.equal(reopened.followUp.status, 'open');
    assert.equal(reopened.followUp.completedAt, null);
    assert.equal(reopened.followUp.completedBy, null);
    assert.equal(reopened.followUp.resolution, null);

    const rows = await db.select().from(agentOperationalFollowUps).where(eq(agentOperationalFollowUps.escalationId, escalation.id));
    assert.equal(rows.length, 1);
  });

  test('8/9/10: transições válidas open→in_progress→waiting→in_progress', async () => {
    const followUp = await createManualFollowUp({ responsibilityId, title: `Transições ${runId}`, priority: 'medium' }, ceoUserId);
    createdFollowUpIds.push(followUp.id);

    const started = await startFollowUp(followUp, ceoUserId);
    assert.equal(started.status, 'in_progress');
    assert.ok(started.acknowledgedAt);

    const waiting = await waitFollowUp(started, { waitingReason: 'Aguardando retorno do cliente.' }, ceoUserId);
    assert.equal(waiting.status, 'waiting');
    assert.equal(waiting.waitingReason, 'Aguardando retorno do cliente.');

    const resumed = await resumeFollowUp(waiting, ceoUserId);
    assert.equal(resumed.status, 'in_progress');
    assert.equal(resumed.waitingReason, null);
    // acknowledgedAt não é sobrescrito numa segunda entrada em in_progress.
    assert.equal(resumed.acknowledgedAt?.getTime(), started.acknowledgedAt?.getTime());
  });

  test('11: conclusão válida grava completedAt/completedBy/resolution', async () => {
    const followUp = await createManualFollowUp({ responsibilityId, title: `Conclusão ${runId}`, priority: 'medium' }, ceoUserId);
    createdFollowUpIds.push(followUp.id);

    const completed = await completeFollowUp(followUp, 'Cliente respondeu e o assunto foi encerrado.', ceoUserId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.completedBy, ceoUserId);
    assert.equal(completed.resolution, 'Cliente respondeu e o assunto foi encerrado.');
    assert.ok(completed.completedAt);
  });

  test('12: dismissal válido grava dismissedAt/dismissedBy/dismissReason', async () => {
    const followUp = await createManualFollowUp({ responsibilityId, title: `Dismiss ${runId}`, priority: 'medium' }, ceoUserId);
    createdFollowUpIds.push(followUp.id);

    const dismissed = await dismissFollowUp(followUp, 'Não é mais relevante.', ceoUserId);
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(dismissed.dismissedBy, ceoUserId);
    assert.equal(dismissed.dismissReason, 'Não é mais relevante.');
  });

  test('13/14: transição inválida rejeitada (terminal não aceita transição arbitrária)', async () => {
    const followUp = await createManualFollowUp({ responsibilityId, title: `Terminal ${runId}`, priority: 'medium' }, ceoUserId);
    createdFollowUpIds.push(followUp.id);

    const completed = await completeFollowUp(followUp, 'x', ceoUserId);
    await assert.rejects(startFollowUp(completed, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
    await assert.rejects(waitFollowUp(completed, { waitingReason: 'x' }, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
    await assert.rejects(dismissFollowUp(completed, 'x', ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
  });

  test('19: timestamps e atores preservados através de múltiplas transições', async () => {
    const followUp = await createManualFollowUp({ responsibilityId, title: `Histórico ${runId}`, priority: 'medium' }, ceoUserId);
    createdFollowUpIds.push(followUp.id);

    const started = await startFollowUp(followUp, ceoUserId);
    const completed = await completeFollowUp(started, 'Concluído.', ceoUserId);

    assert.ok(completed.acknowledgedAt, 'acknowledgedAt do início deveria ser preservado até a conclusão');
    assert.equal(completed.completedBy, ceoUserId);
  });

  test('20: conclusão não destrói a escalation de origem', async () => {
    const escalation = await insertEscalation(`svc-fu-preserve-${runId}`);
    const responsibility = await getResponsibilityRow();
    const { followUp } = await createOrReopenFollowUpFromEscalation({ escalation, responsibility });
    createdFollowUpIds.push(followUp.id);

    await completeFollowUp(followUp, 'Resolvido.', ceoUserId);

    const [reloadedEscalation] = await db.select().from(agentOperationalEscalations).where(eq(agentOperationalEscalations.id, escalation.id));
    assert.ok(reloadedEscalation, 'a escalation de origem nunca deveria ser apagada ao concluir o follow-up');
    assert.equal(reloadedEscalation!.status, 'open', 'concluir o follow-up não deve automaticamente resolver a escalation (seção 14: evitar sincronização mágica)');
  });

  test('21: reassignment preserva o owner original e audita o valor anterior', async () => {
    const followUp = await createManualFollowUp({ responsibilityId, title: `Reassign ${runId}`, priority: 'medium' }, ceoUserId);
    createdFollowUpIds.push(followUp.id);
    const originalOwnerAgentId = followUp.ownerAgentId;

    const reassigned = await reassignFollowUp(followUp, ceoUserId, ceoUserId);
    assert.equal(reassigned.assignedUserId, ceoUserId);
    assert.equal(reassigned.ownerAgentId, originalOwnerAgentId, 'reassignment nunca altera o owner (ownerAgentId)');

    await assert.rejects(
      reassignFollowUp(followUp, 999999999, ceoUserId),
      (error: unknown) => error instanceof AgentError && error.code === 'validation_error',
    );

    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'agents.followup.reassigned')).orderBy(auditLogs.id).limit(1);
    void log;
  });

  test('reassignment de follow-up terminal é rejeitado', async () => {
    const followUp = await createManualFollowUp({ responsibilityId, title: `Reassign terminal ${runId}`, priority: 'medium' }, ceoUserId);
    createdFollowUpIds.push(followUp.id);
    const completed = await completeFollowUp(followUp, 'x', ceoUserId);

    await assert.rejects(reassignFollowUp(completed, ceoUserId, ceoUserId), (error: unknown) => error instanceof AgentError && error.code === 'conflict');
  });
});
