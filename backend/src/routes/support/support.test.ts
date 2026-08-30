import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { clients, projects, roles, supportCategories, supportTickets, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';

/*
 * Testes de integração do módulo Suporte v1. Rodam contra o banco apontado
 * por DATABASE_URL usando `app.inject()` — sem mocks, sem subir um servidor
 * HTTP de verdade. Requer que o seed (`npm run db:seed`) já tenha rodado
 * (login usa CEO_EMAIL/CEO_PASSWORD; permissions `support.*` e a categoria
 * de sistema "bug" precisam existir).
 *
 * Registros criados pelos testes são removidos ao final (hook `after`) —
 * apagar `support_tickets` já remove em cascata mensagens e histórico.
 */

describe('Suporte v1', () => {
  const app = buildApp();

  const runId = Date.now();

  let ceoToken: string;
  let noPermissionToken: string;
  let restrictedRoleId: number | undefined;
  let restrictedUserId: number | undefined;
  let categoryId: number;
  let clientId: number;

  const createdTicketIds: number[] = [];
  const createdProjectIds: number[] = [];
  const createdClientIds: number[] = [];

  async function login(email: string, password: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    assert.equal(response.statusCode, 200, `Falha no login de ${email}: ${response.body}`);

    return response.json().token as string;
  }

  function authHeader(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createTicket(overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/support/tickets',
      headers: authHeader(ceoToken),
      payload: {
        clientId,
        categoryId,
        title: `Ticket de teste ${runId}-${createdTicketIds.length}`,
        ...overrides,
      },
    });

    if (response.statusCode === 201) {
      createdTicketIds.push(response.json().data.id);
    }

    return response;
  }

  before(async () => {
    await app.ready();

    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;

    assert.ok(
      ceoEmail && ceoPassword,
      'CEO_EMAIL/CEO_PASSWORD precisam estar definidos (rode npm run db:seed antes dos testes).',
    );

    ceoToken = await login(ceoEmail, ceoPassword);

    const [category] = await db
      .select()
      .from(supportCategories)
      .where(eq(supportCategories.slug, 'bug'))
      .limit(1);

    assert.ok(category, 'Categoria de sistema "bug" do seed não encontrada.');
    categoryId = category.id;

    const clientResponse = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Cliente Suporte ${runId}`, status: 'active' },
    });
    assert.equal(clientResponse.statusCode, 201, clientResponse.body);
    clientId = clientResponse.json().data.id;
    createdClientIds.push(clientId);

    const [restrictedRole] = await db
      .insert(roles)
      .values({
        name: `Sem Permissão ${runId}`,
        slug: `no-permission-support-${runId}`,
        description: 'Role de teste sem nenhuma permissão.',
        isSystem: false,
      })
      .returning();

    restrictedRoleId = restrictedRole.id;

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);

    const [restrictedUser] = await db
      .insert(users)
      .values({
        name: `Usuário Sem Permissão ${runId}`,
        email: `no-permission-support-${runId}@example.com`,
        passwordHash,
        roleId: restrictedRole.id,
        isActive: true,
      })
      .returning();

    restrictedUserId = restrictedUser.id;

    noPermissionToken = await login(restrictedUser.email, 'senha-teste-12345');
  });

  after(async () => {
    for (const id of createdTicketIds) {
      await db.delete(supportTickets).where(eq(supportTickets.id, id));
    }

    for (const id of createdProjectIds) {
      await db.delete(projects).where(eq(projects.id, id));
    }

    for (const id of createdClientIds) {
      await db.delete(clients).where(eq(clients.id, id));
    }

    if (restrictedUserId) {
      await db.delete(users).where(eq(users.id, restrictedUserId));
    }

    if (restrictedRoleId) {
      await db.delete(roles).where(eq(roles.id, restrictedRoleId));
    }

    await app.close();
    await database.end();
  });

  test('cria ticket com sucesso', async () => {
    const response = await createTicket();

    assert.equal(response.statusCode, 201, response.body);

    const ticket = response.json().data;
    assert.equal(ticket.status, 'open');
    assert.equal(ticket.clientId, clientId);
    assert.ok(ticket.slaDueAt, 'sla_due_at deveria ter sido calculado a partir da política de SLA.');
  });

  test('criar ticket sem permission é rejeitado (403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/support/tickets',
      headers: authHeader(noPermissionToken),
      payload: { clientId, categoryId, title: 'Ticket sem permissão' },
    });

    assert.equal(response.statusCode, 403, response.body);
  });

  test('projeto de outro cliente é rejeitado', async () => {
    const otherClientResponse = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Outro Cliente Suporte ${runId}`, status: 'active' },
    });
    assert.equal(otherClientResponse.statusCode, 201, otherClientResponse.body);
    const otherClient = otherClientResponse.json().data;
    createdClientIds.push(otherClient.id);

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: authHeader(ceoToken),
      payload: { clientId: otherClient.id, name: `Projeto Suporte ${runId}` },
    });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body);
    const project = projectResponse.json().data;
    createdProjectIds.push(project.id);

    const response = await createTicket({ projectId: project.id });

    assert.equal(response.statusCode, 422, response.body);
    assert.equal(response.json().error, 'client_project_mismatch');
  });

  test('first_response_at é preenchido uma única vez', async () => {
    const ticketResponse = await createTicket();
    const ticket = ticketResponse.json().data;

    const firstMessage = await app.inject({
      method: 'POST',
      url: `/support/tickets/${ticket.id}/messages`,
      headers: authHeader(ceoToken),
      payload: { type: 'message', content: 'Primeira resposta.' },
    });
    assert.equal(firstMessage.statusCode, 201, firstMessage.body);

    const afterFirst = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticket.id}`,
      headers: authHeader(ceoToken),
    });
    const firstResponseAt = afterFirst.json().data.firstResponseAt;
    assert.ok(firstResponseAt);

    const secondMessage = await app.inject({
      method: 'POST',
      url: `/support/tickets/${ticket.id}/messages`,
      headers: authHeader(ceoToken),
      payload: { type: 'message', content: 'Segunda resposta.' },
    });
    assert.equal(secondMessage.statusCode, 201, secondMessage.body);

    const afterSecond = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticket.id}`,
      headers: authHeader(ceoToken),
    });

    assert.equal(afterSecond.json().data.firstResponseAt, firstResponseAt);
  });

  test('overdue é derivado corretamente (não persistido)', async () => {
    // Prioridade crítica (política de SLA de 2h) — cria um ticket e então
    // adianta manualmente o sla_due_at para o passado via update direto no
    // banco, simulando um chamado antigo.
    const response = await createTicket({ priority: 'critical' });
    const ticket = response.json().data;

    await db
      .update(supportTickets)
      .set({ slaDueAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(supportTickets.id, ticket.id));

    const detail = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticket.id}`,
      headers: authHeader(ceoToken),
    });

    assert.equal(detail.json().data.isOverdue, true);

    const list = await app.inject({
      method: 'GET',
      url: '/support/tickets?overdue=true',
      headers: authHeader(ceoToken),
    });
    const ids = list.json().data.map((row: { id: number }) => row.id);
    assert.ok(ids.includes(ticket.id));
  });

  test('resolver, reabrir e fechar ticket', async () => {
    const response = await createTicket();
    const ticket = response.json().data;

    const resolveResponse = await app.inject({
      method: 'PATCH',
      url: `/support/tickets/${ticket.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'resolved', resolution: 'Resolvido no teste automatizado.' },
    });
    assert.equal(resolveResponse.statusCode, 200, resolveResponse.body);
    assert.equal(resolveResponse.json().data.status, 'resolved');
    assert.ok(resolveResponse.json().data.resolvedAt);

    const closeWithoutResolveAttempt = await app.inject({
      method: 'PATCH',
      url: `/support/tickets/${ticket.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'closed' },
    });
    assert.equal(closeWithoutResolveAttempt.statusCode, 200, closeWithoutResolveAttempt.body);
    assert.equal(closeWithoutResolveAttempt.json().data.status, 'closed');
    assert.ok(closeWithoutResolveAttempt.json().data.closedAt);

    const reopenResponse = await app.inject({
      method: 'PATCH',
      url: `/support/tickets/${ticket.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'in_progress' },
    });
    assert.equal(reopenResponse.statusCode, 200, reopenResponse.body);
    assert.equal(reopenResponse.json().data.status, 'in_progress');
    assert.equal(reopenResponse.json().data.resolvedAt, null);
    assert.equal(reopenResponse.json().data.closedAt, null);
  });

  test('fechar ticket não resolvido é rejeitado', async () => {
    const response = await createTicket();
    const ticket = response.json().data;

    const closeResponse = await app.inject({
      method: 'PATCH',
      url: `/support/tickets/${ticket.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'closed' },
    });

    assert.equal(closeResponse.statusCode, 422, closeResponse.body);
    assert.equal(closeResponse.json().error, 'ticket_not_resolved');
  });

  test('adiciona mensagem e nota interna', async () => {
    const response = await createTicket();
    const ticket = response.json().data;

    const messageResponse = await app.inject({
      method: 'POST',
      url: `/support/tickets/${ticket.id}/messages`,
      headers: authHeader(ceoToken),
      payload: { type: 'message', content: 'Mensagem visível ao cliente.', isInternal: false },
    });
    assert.equal(messageResponse.statusCode, 201, messageResponse.body);
    assert.equal(messageResponse.json().data.isInternal, false);

    const noteResponse = await app.inject({
      method: 'POST',
      url: `/support/tickets/${ticket.id}/messages`,
      headers: authHeader(ceoToken),
      payload: { type: 'note', content: 'Nota interna da equipe.', isInternal: true },
    });
    assert.equal(noteResponse.statusCode, 201, noteResponse.body);
    assert.equal(noteResponse.json().data.isInternal, true);

    const listResponse = await app.inject({
      method: 'GET',
      url: `/support/tickets/${ticket.id}/messages`,
      headers: authHeader(ceoToken),
    });
    assert.equal(listResponse.json().data.length, 2);
  });

  test('stats de suporte retornam campos agregados', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/support/stats',
      headers: authHeader(ceoToken),
    });

    assert.equal(response.statusCode, 200, response.body);

    const stats = response.json();
    for (const field of [
      'open',
      'inProgress',
      'waitingCustomer',
      'critical',
      'overdue',
      'resolvedThisMonth',
      'averageFirstResponseMinutes',
      'averageResolutionMinutes',
    ]) {
      assert.ok(field in stats, `campo ausente: ${field}`);
    }
  });

  test('acesso sem JWT é rejeitado (401)', async () => {
    const response = await app.inject({ method: 'GET', url: '/support/tickets' });
    assert.equal(response.statusCode, 401);
  });
});
