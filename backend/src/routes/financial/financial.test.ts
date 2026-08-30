import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  clients,
  financialCategories,
  financialEntries,
  projects,
  roles,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';

/*
 * Testes de integração do módulo Financeiro v1. Rodam contra o banco
 * apontado por DATABASE_URL usando `app.inject()` — sem mocks, sem subir um
 * servidor HTTP de verdade. Requer que o seed (`npm run db:seed`) já tenha
 * sido executado, pois o login usa as credenciais do CEO
 * (CEO_EMAIL/CEO_PASSWORD) e as permissions `financial.*` precisam existir,
 * assim como as categorias de sistema seedadas ("project"/"hosting").
 *
 * Todos os registros criados pelos testes são removidos ao final (hook
 * `after`) — apagar `financial_entries` já remove em cascata os pagamentos.
 */

describe('Financeiro v1', () => {
  const app = buildApp();

  const runId = Date.now();

  let ceoToken: string;
  let noPermissionToken: string;
  let restrictedRoleId: number | undefined;
  let restrictedUserId: number | undefined;
  let incomeCategoryId: number;
  let expenseCategoryId: number;

  const createdEntryIds: number[] = [];
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

  async function createEntry(overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/financial/entries',
      headers: authHeader(ceoToken),
      payload: {
        type: 'income',
        categoryId: incomeCategoryId,
        description: `Lançamento de teste ${runId}-${createdEntryIds.length}`,
        amount: 1000,
        issueDate: '2026-08-01',
        dueDate: '2026-08-15',
        competenceDate: '2026-08-01',
        ...overrides,
      },
    });

    if (response.statusCode === 201) {
      createdEntryIds.push(response.json().data.id);
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

    const [incomeCategory] = await db
      .select()
      .from(financialCategories)
      .where(eq(financialCategories.slug, 'project'))
      .limit(1);

    const [expenseCategory] = await db
      .select()
      .from(financialCategories)
      .where(eq(financialCategories.slug, 'hosting'))
      .limit(1);

    assert.ok(incomeCategory && expenseCategory, 'Categorias de sistema do seed não encontradas.');

    incomeCategoryId = incomeCategory.id;
    expenseCategoryId = expenseCategory.id;

    const [restrictedRole] = await db
      .insert(roles)
      .values({
        name: `Sem Permissão ${runId}`,
        slug: `no-permission-financial-${runId}`,
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
        email: `no-permission-financial-${runId}@example.com`,
        passwordHash,
        roleId: restrictedRole.id,
        isActive: true,
      })
      .returning();

    restrictedUserId = restrictedUser.id;

    noPermissionToken = await login(restrictedUser.email, 'senha-teste-12345');
  });

  after(async () => {
    for (const id of createdEntryIds) {
      await db.delete(financialEntries).where(eq(financialEntries.id, id));
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

  test('cria receita com sucesso', async () => {
    const response = await createEntry({ type: 'income', categoryId: incomeCategoryId });

    assert.equal(response.statusCode, 201, response.body);

    const entry = response.json().data;
    assert.equal(entry.type, 'income');
    assert.equal(entry.status, 'pending');
    assert.equal(entry.amount, '1000.00');
    assert.equal(entry.paidAmount, '0.00');
    assert.equal(entry.remainingAmount, '1000.00');
  });

  test('cria despesa com sucesso', async () => {
    const response = await createEntry({ type: 'expense', categoryId: expenseCategoryId });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.type, 'expense');
  });

  test('valor zero é rejeitado', async () => {
    const response = await createEntry({ amount: 0 });

    assert.equal(response.statusCode, 400, response.body);
  });

  test('cliente/projeto inconsistente é rejeitado', async () => {
    // Cria um cliente e um projeto vinculado a ele; depois tenta criar um
    // lançamento apontando para esse projeto mas para outro clientId.
    const clientResponse = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Cliente Financeiro ${runId}`, status: 'active' },
    });
    assert.equal(clientResponse.statusCode, 201, clientResponse.body);
    const client = clientResponse.json().data;
    createdClientIds.push(client.id);

    const otherClientResponse = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Outro Cliente Financeiro ${runId}`, status: 'active' },
    });
    assert.equal(otherClientResponse.statusCode, 201, otherClientResponse.body);
    const otherClient = otherClientResponse.json().data;
    createdClientIds.push(otherClient.id);

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: authHeader(ceoToken),
      payload: { clientId: client.id, name: `Projeto Financeiro ${runId}` },
    });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body);
    const project = projectResponse.json().data;
    createdProjectIds.push(project.id);

    const response = await createEntry({ projectId: project.id, clientId: otherClient.id });

    assert.equal(response.statusCode, 422, response.body);
    assert.equal(response.json().error, 'client_project_mismatch');
  });

  test('pagamento parcial mantém status pending', async () => {
    const entryResponse = await createEntry({ amount: 1000 });
    const entry = entryResponse.json().data;

    const paymentResponse = await app.inject({
      method: 'POST',
      url: `/financial/entries/${entry.id}/payments`,
      headers: authHeader(ceoToken),
      payload: { amount: 400 },
    });

    assert.equal(paymentResponse.statusCode, 201, paymentResponse.body);
    assert.equal(paymentResponse.json().data.entry.status, 'pending');
    assert.equal(paymentResponse.json().data.entry.id, entry.id);
  });

  test('pagamento total quita o lançamento (status = paid)', async () => {
    const entryResponse = await createEntry({ amount: 500 });
    const entry = entryResponse.json().data;

    const paymentResponse = await app.inject({
      method: 'POST',
      url: `/financial/entries/${entry.id}/payments`,
      headers: authHeader(ceoToken),
      payload: { amount: 500 },
    });

    assert.equal(paymentResponse.statusCode, 201, paymentResponse.body);
    assert.equal(paymentResponse.json().data.entry.status, 'paid');
    assert.ok(paymentResponse.json().data.entry.paidAt);
  });

  test('pagamento acima do saldo é rejeitado', async () => {
    const entryResponse = await createEntry({ amount: 300 });
    const entry = entryResponse.json().data;

    const paymentResponse = await app.inject({
      method: 'POST',
      url: `/financial/entries/${entry.id}/payments`,
      headers: authHeader(ceoToken),
      payload: { amount: 301 },
    });

    assert.equal(paymentResponse.statusCode, 422, paymentResponse.body);
    assert.equal(paymentResponse.json().error, 'amount_exceeds_balance');
  });

  test('pagamentos concorrentes não ultrapassam o saldo', async () => {
    const entryResponse = await createEntry({ amount: 1000 });
    const entry = entryResponse.json().data;

    const payPayload = { amount: 700 };

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/financial/entries/${entry.id}/payments`,
        headers: authHeader(ceoToken),
        payload: payPayload,
      }),
      app.inject({
        method: 'POST',
        url: `/financial/entries/${entry.id}/payments`,
        headers: authHeader(ceoToken),
        payload: payPayload,
      }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    // Exatamente um dos dois pagamentos de 700 deve ser aceito (o segundo
    // ultrapassaria o saldo de 1000) — o lock FOR UPDATE serializa as duas
    // transações.
    assert.deepEqual(statuses, [201, 422]);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/financial/entries/${entry.id}`,
      headers: authHeader(ceoToken),
    });

    assert.equal(Number(detailResponse.json().data.paidAmount), 700);
  });

  test('stats retornam valores agregados coerentes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/financial/stats',
      headers: authHeader(ceoToken),
    });

    assert.equal(response.statusCode, 200, response.body);

    const stats = response.json();
    for (const field of [
      'receivablePending',
      'payablePending',
      'incomePaidThisMonth',
      'expensePaidThisMonth',
      'resultThisMonth',
      'overdueReceivable',
      'overduePayable',
    ]) {
      assert.ok(field in stats, `campo ausente: ${field}`);
    }
  });

  test('overdue é derivado corretamente (não persistido)', async () => {
    const entryResponse = await createEntry({ dueDate: '2020-01-01' });
    const entry = entryResponse.json().data;

    assert.equal(entry.isOverdue, true);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/financial/entries?status=overdue',
      headers: authHeader(ceoToken),
    });

    assert.equal(listResponse.statusCode, 200, listResponse.body);
    const ids = listResponse.json().data.map((row: { id: number }) => row.id);
    assert.ok(ids.includes(entry.id));
  });

  // v1.1 seção 1: due_date = hoje NUNCA é vencido (regra canônica
  // due_date < hoje AND status = pending, ver overdueEntryCondition() em
  // routes/financial/helpers.ts). Antes da correção, o filtro
  // status=overdue da listagem usava `<=` e incluía esse caso
  // incorretamente.
  test('lançamento com vencimento hoje não é considerado vencido', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const entryResponse = await createEntry({ dueDate: today });
    const entry = entryResponse.json().data;

    assert.equal(entry.isOverdue, false);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/financial/entries/${entry.id}`,
      headers: authHeader(ceoToken),
    });
    assert.equal(detailResponse.json().data.isOverdue, false);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/financial/entries?status=overdue',
      headers: authHeader(ceoToken),
    });

    assert.equal(listResponse.statusCode, 200, listResponse.body);
    const ids = listResponse.json().data.map((row: { id: number }) => row.id);
    assert.ok(!ids.includes(entry.id), 'lançamento com vencimento hoje não deveria aparecer em status=overdue');
  });

  test('acesso sem JWT é rejeitado (401)', async () => {
    const response = await app.inject({ method: 'GET', url: '/financial/entries' });
    assert.equal(response.statusCode, 401);
  });

  test('acesso sem permission é rejeitado (403)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/financial/entries',
      headers: authHeader(noPermissionToken),
    });
    assert.equal(response.statusCode, 403);
  });
});
