import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  clients,
  crmActivities,
  customerSuccessAccounts,
  financialCategories,
  financialEntries,
  leads,
  pipelineStages,
  projects,
  supportCategories,
  supportTickets,
  tasks,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';

import { collectOperationalSignals } from './operational-signals.js';
import { listOperationalSignals } from './operations-service.js';
import { DIRECTOR_THRESHOLDS } from './thresholds.js';

/*
 * Agentes v1.8 (correio.md secao 20) - deteccao de sinais: positiva, sem
 * falso positivo, threshold, ordenacao por severidade, isolamento entre
 * dominios, `now` controlado (nunca Date.now() direto). Fixtures reais
 * via HTTP (mesmo padrao dos testes de cada modulo), `now` injetado em
 * todo lugar onde a logica de sinal depende de tempo.
 */
describe('Agentes v1.8 - Operational Signals (deteccao)', () => {
  const app = buildApp();
  const runId = Date.now();
  const NOW = new Date('2026-06-15T12:00:00.000Z');

  let ceoToken: string;
  let clientId: number;

  const createdLeadIds: number[] = [];
  const createdTaskIds: number[] = [];
  const createdProjectIds: number[] = [];
  const createdEntryIds: number[] = [];
  const createdTicketIds: number[] = [];
  const createdAccountIds: number[] = [];
  const createdClientIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);
    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  before(async () => {
    await app.ready();

    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;
    assert.ok(ceoEmail && ceoPassword);
    ceoToken = await login(ceoEmail, ceoPassword);

    const clientResponse = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Cliente Director ${runId}`, status: 'active' },
    });
    assert.equal(clientResponse.statusCode, 201, clientResponse.body);
    clientId = clientResponse.json().data.id;
    createdClientIds.push(clientId);

    // --- CRM: lead com follow-up vencido, lead sem follow-up (velho),
    // lead sem follow-up (recente, nao deveria disparar), lead com
    // follow-up no futuro (nao deveria disparar) ---
    const leadOverdue = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead follow-up vencido ${runId}`, nextActionAt: '2026-06-10T12:00:00.000Z' },
    });
    createdLeadIds.push(leadOverdue.json().data.id);

    const leadFuture = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead follow-up futuro ${runId}`, nextActionAt: '2026-06-20T12:00:00.000Z' },
    });
    createdLeadIds.push(leadFuture.json().data.id);

    const leadNoActionFresh = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead recente sem follow-up ${runId}` },
    });
    createdLeadIds.push(leadNoActionFresh.json().data.id);
    // createdAt real (agora, no momento do teste) — sempre "recente" em
    // relação ao NOW fixo de 2026-06-15, então nunca deveria disparar
    // missing_follow_up mesmo que o teste rode em outra data real.

    const leadNoActionStale = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead antigo sem follow-up ${runId}` },
    });
    createdLeadIds.push(leadNoActionStale.json().data.id);
    // Força createdAt para antes do threshold em relação ao NOW fixo.
    await db
      .update(leads)
      .set({ createdAt: new Date(NOW.getTime() - (DIRECTOR_THRESHOLDS.leadStaleDays + 1) * 24 * 60 * 60 * 1000) })
      .where(eq(leads.id, leadNoActionStale.json().data.id));

    // --- Projects: projeto atrasado, tarefa atrasada, tarefa due-soon,
    // tarefa bloqueada, tarefa sem responsável ---
    const project = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: authHeader(ceoToken),
      payload: { clientId, name: `Projeto Director ${runId}`, dueDate: '2026-06-10' },
    });
    const projectId = project.json().data.id;
    createdProjectIds.push(projectId);

    const overdueTask = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/tasks`,
      headers: authHeader(ceoToken),
      payload: { title: `Tarefa atrasada ${runId}`, dueDate: '2026-06-10' },
    });
    createdTaskIds.push(overdueTask.json().data.id);

    const dueSoonTask = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/tasks`,
      headers: authHeader(ceoToken),
      payload: { title: `Tarefa due-soon ${runId}`, dueDate: '2026-06-16' },
    });
    createdTaskIds.push(dueSoonTask.json().data.id);

    const blockedTask = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/tasks`,
      headers: authHeader(ceoToken),
      payload: { title: `Tarefa bloqueada ${runId}`, status: 'blocked' },
    });
    createdTaskIds.push(blockedTask.json().data.id);

    const unassignedTask = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/tasks`,
      headers: authHeader(ceoToken),
      payload: { title: `Tarefa sem responsável ${runId}` },
    });
    createdTaskIds.push(unassignedTask.json().data.id);

    // --- Financial: recebível vencido, pagável vencido ---
    const [incomeCategory] = await db.select().from(financialCategories).where(eq(financialCategories.slug, 'project')).limit(1);
    const [expenseCategory] = await db.select().from(financialCategories).where(eq(financialCategories.slug, 'hosting')).limit(1);
    assert.ok(incomeCategory && expenseCategory);

    const receivable = await app.inject({
      method: 'POST',
      url: '/financial/entries',
      headers: authHeader(ceoToken),
      payload: {
        type: 'income',
        categoryId: incomeCategory.id,
        clientId,
        description: `Recebível vencido ${runId}`,
        amount: 1000,
        issueDate: '2026-06-01',
        dueDate: '2026-06-05',
        competenceDate: '2026-06-01',
      },
    });
    createdEntryIds.push(receivable.json().data.id);

    const payable = await app.inject({
      method: 'POST',
      url: '/financial/entries',
      headers: authHeader(ceoToken),
      payload: {
        type: 'expense',
        categoryId: expenseCategory.id,
        description: `Pagável vencido ${runId}`,
        amount: 200,
        issueDate: '2026-06-01',
        dueDate: '2026-06-05',
        competenceDate: '2026-06-01',
      },
    });
    createdEntryIds.push(payable.json().data.id);

    // --- Support: ticket crítico, ticket com SLA vencido ---
    const [category] = await db.select().from(supportCategories).where(eq(supportCategories.slug, 'bug')).limit(1);
    assert.ok(category);

    const criticalTicket = await app.inject({
      method: 'POST',
      url: '/support/tickets',
      headers: authHeader(ceoToken),
      payload: { clientId, categoryId: category.id, title: `Ticket crítico ${runId}`, priority: 'critical' },
    });
    createdTicketIds.push(criticalTicket.json().data.id);

    const overdueTicket = await app.inject({
      method: 'POST',
      url: '/support/tickets',
      headers: authHeader(ceoToken),
      payload: { clientId, categoryId: category.id, title: `Ticket SLA vencido ${runId}` },
    });
    const overdueTicketId = overdueTicket.json().data.id;
    createdTicketIds.push(overdueTicketId);
    await db.update(supportTickets).set({ slaDueAt: new Date(NOW.getTime() - 60 * 60 * 1000) }).where(eq(supportTickets.id, overdueTicketId));

    // --- Customer Success: conta em risco, follow-up pendente ---
    const atRiskClient = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Cliente em risco ${runId}`, status: 'active' },
    });
    const atRiskClientId = atRiskClient.json().data.id;
    createdClientIds.push(atRiskClientId);

    const atRiskAccount = await app.inject({
      method: 'POST',
      url: '/customer-success/accounts',
      headers: authHeader(ceoToken),
      payload: { clientId: atRiskClientId },
    });
    const atRiskAccountId = atRiskAccount.json().data.id;
    createdAccountIds.push(atRiskAccountId);
    await app.inject({
      method: 'PATCH',
      url: `/customer-success/accounts/${atRiskAccountId}`,
      headers: authHeader(ceoToken),
      payload: { status: 'at_risk' },
    });

    const followUpClient = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Cliente follow-up ${runId}`, status: 'active' },
    });
    const followUpClientId = followUpClient.json().data.id;
    createdClientIds.push(followUpClientId);

    const followUpAccount = await app.inject({
      method: 'POST',
      url: '/customer-success/accounts',
      headers: authHeader(ceoToken),
      payload: { clientId: followUpClientId },
    });
    const followUpAccountId = followUpAccount.json().data.id;
    createdAccountIds.push(followUpAccountId);
    await app.inject({
      method: 'PATCH',
      url: `/customer-success/accounts/${followUpAccountId}`,
      headers: authHeader(ceoToken),
      payload: { nextContactAt: '2026-06-10T12:00:00.000Z' },
    });
  });

  after(async () => {
    if (createdTicketIds.length > 0) await db.delete(supportTickets).where(inArray(supportTickets.id, createdTicketIds));
    if (createdEntryIds.length > 0) await db.delete(financialEntries).where(inArray(financialEntries.id, createdEntryIds));
    if (createdAccountIds.length > 0) await db.delete(customerSuccessAccounts).where(inArray(customerSuccessAccounts.id, createdAccountIds));
    if (createdTaskIds.length > 0) await db.delete(tasks).where(inArray(tasks.id, createdTaskIds));
    if (createdProjectIds.length > 0) await db.delete(projects).where(inArray(projects.id, createdProjectIds));
    if (createdLeadIds.length > 0) {
      await db.delete(crmActivities).where(inArray(crmActivities.leadId, createdLeadIds));
      await db.delete(leads).where(inArray(leads.id, createdLeadIds));
    }
    if (createdClientIds.length > 0) await db.delete(clients).where(inArray(clients.id, createdClientIds));

    await database.end();
    redis.disconnect();
  });

  test('detecção positiva: um sinal por situação real criada, em cada domínio', async () => {
    const { signals, errors } = await collectOperationalSignals(NOW);
    assert.deepEqual(errors, []);

    const byId = new Map(signals.map((signal) => [signal.id, signal]));

    assert.ok(byId.has(`crm.lead_follow_up_overdue:${createdLeadIds[0]}`), 'lead com follow-up vencido deveria gerar sinal');
    assert.ok(byId.has(`crm.lead_missing_follow_up:${createdLeadIds[3]}`), 'lead antigo sem follow-up deveria gerar sinal');
    assert.ok(byId.has(`projects.task_overdue:${createdTaskIds[0]}`));
    assert.ok(byId.has(`projects.task_due_soon:${createdTaskIds[1]}`));
    assert.ok(byId.has(`projects.task_blocked:${createdTaskIds[2]}`));
    assert.ok(byId.has(`projects.task_unassigned:${createdTaskIds[3]}`));
    assert.ok(byId.has(`projects.project_overdue:${createdProjectIds[0]}`));
    assert.ok(byId.has(`finance.receivable_overdue:${createdEntryIds[0]}`));
    assert.ok(byId.has(`finance.payable_overdue:${createdEntryIds[1]}`));
    assert.ok(byId.has(`support.ticket_critical:${createdTicketIds[0]}`));
    assert.ok(byId.has(`support.ticket_overdue:${createdTicketIds[1]}`));
    assert.ok(byId.has(`support.account_at_risk:${createdAccountIds[0]}`));
    assert.ok(byId.has(`support.follow_up_due:${createdAccountIds[1]}`));
  });

  test('não detecta falso positivo: lead com follow-up no futuro e lead recente sem follow-up nunca disparam', async () => {
    const { signals } = await collectOperationalSignals(NOW);
    const ids = new Set(signals.map((s) => s.id));

    assert.equal(ids.has(`crm.lead_follow_up_overdue:${createdLeadIds[1]}`), false);
    assert.equal(ids.has(`crm.lead_missing_follow_up:${createdLeadIds[1]}`), false);
    assert.equal(ids.has(`crm.lead_missing_follow_up:${createdLeadIds[2]}`), false, 'lead recente sem follow-up não deveria disparar antes do threshold');
  });

  test('threshold: lead sem follow-up só dispara depois de leadStaleDays', async () => {
    const justUnderThreshold = new Date(
      NOW.getTime() - (DIRECTOR_THRESHOLDS.leadStaleDays * 24 * 60 * 60 * 1000 - 1000),
    );
    const { signals } = await collectOperationalSignals(justUnderThreshold);
    const ids = new Set(signals.map((s) => s.id));
    assert.equal(ids.has(`crm.lead_missing_follow_up:${createdLeadIds[3]}`), false, 'a 1s do threshold ainda não deveria disparar');
  });

  test('isolamento entre domínios: sinal de um domínio nunca aparece marcado como outro', async () => {
    const { signals } = await collectOperationalSignals(NOW);
    const leadSignal = signals.find((s) => s.id === `crm.lead_follow_up_overdue:${createdLeadIds[0]}`);
    const taskSignal = signals.find((s) => s.id === `projects.task_overdue:${createdTaskIds[0]}`);

    assert.equal(leadSignal?.domain, 'crm');
    assert.equal(taskSignal?.domain, 'projects');
  });

  test('ordenação por severidade: critical sempre antes de warning, warning antes de attention', async () => {
    const { signals } = await listOperationalSignals(NOW);
    const severityRank: Record<string, number> = { critical: 0, warning: 1, attention: 2, info: 3 };

    for (let i = 1; i < signals.length; i += 1) {
      assert.ok(
        severityRank[signals[i - 1].severity] <= severityRank[signals[i].severity],
        `sinal ${signals[i - 1].id} (${signals[i - 1].severity}) apareceu antes de ${signals[i].id} (${signals[i].severity}) fora de ordem`,
      );
    }

    const firstAttentionIndex = signals.findIndex((s) => s.severity === 'attention');
    const lastCriticalIndex = signals.map((s) => s.severity).lastIndexOf('critical');
    if (firstAttentionIndex !== -1 && lastCriticalIndex !== -1) {
      assert.ok(lastCriticalIndex < firstAttentionIndex);
    }
  });
});
