import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  clients,
  customerSuccessAccounts,
  customerSuccessOpportunities,
  roles,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';

/*
 * Testes de integração do módulo Customer Success v1. Mesmo formato de
 * support.test.ts / financial.test.ts — `app.inject()` contra o banco real,
 * requer seed já executado (login usa CEO_EMAIL/CEO_PASSWORD).
 */

describe('Customer Success v1', () => {
  const app = buildApp();

  const runId = Date.now();

  let ceoToken: string;
  let noPermissionToken: string;
  let restrictedRoleId: number | undefined;
  let restrictedUserId: number | undefined;
  let clientId: number;

  const createdClientIds: number[] = [];
  const createdAccountIds: number[] = [];
  const createdOpportunityIds: number[] = [];

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

  before(async () => {
    await app.ready();

    const ceoEmail = process.env.CEO_EMAIL;
    const ceoPassword = process.env.CEO_PASSWORD;

    assert.ok(
      ceoEmail && ceoPassword,
      'CEO_EMAIL/CEO_PASSWORD precisam estar definidos (rode npm run db:seed antes dos testes).',
    );

    ceoToken = await login(ceoEmail, ceoPassword);

    const clientResponse = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Cliente CS ${runId}`, status: 'active' },
    });
    assert.equal(clientResponse.statusCode, 201, clientResponse.body);
    clientId = clientResponse.json().data.id;
    createdClientIds.push(clientId);

    const [restrictedRole] = await db
      .insert(roles)
      .values({
        name: `Sem Permissão ${runId}`,
        slug: `no-permission-cs-${runId}`,
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
        email: `no-permission-cs-${runId}@example.com`,
        passwordHash,
        roleId: restrictedRole.id,
        isActive: true,
      })
      .returning();

    restrictedUserId = restrictedUser.id;

    noPermissionToken = await login(restrictedUser.email, 'senha-teste-12345');
  });

  after(async () => {
    for (const id of createdOpportunityIds) {
      await db.delete(customerSuccessOpportunities).where(eq(customerSuccessOpportunities.id, id));
    }

    for (const id of createdAccountIds) {
      await db.delete(customerSuccessAccounts).where(eq(customerSuccessAccounts.id, id));
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

  test('cria conta CS sob demanda (idempotente)', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/customer-success/accounts',
      headers: authHeader(ceoToken),
      payload: { clientId },
    });
    assert.equal(first.statusCode, 201, first.body);
    const account = first.json().data;
    createdAccountIds.push(account.id);
    assert.equal(account.clientId, clientId);
    assert.equal(account.status, 'onboarding');

    const second = await app.inject({
      method: 'POST',
      url: '/customer-success/accounts',
      headers: authHeader(ceoToken),
      payload: { clientId },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().data.id, account.id);
  });

  test('health score inválido é rejeitado', async () => {
    const [account] = await db
      .select()
      .from(customerSuccessAccounts)
      .where(eq(customerSuccessAccounts.clientId, clientId))
      .limit(1);

    const response = await app.inject({
      method: 'PATCH',
      url: `/customer-success/accounts/${account.id}`,
      headers: authHeader(ceoToken),
      payload: { healthScore: 150 },
    });

    assert.equal(response.statusCode, 400, response.body);
  });

  test('atividade CS atualiza last_contact_at', async () => {
    const [account] = await db
      .select()
      .from(customerSuccessAccounts)
      .where(eq(customerSuccessAccounts.clientId, clientId))
      .limit(1);

    assert.equal(account.lastContactAt, null);

    const response = await app.inject({
      method: 'POST',
      url: `/customer-success/accounts/${account.id}/activities`,
      headers: authHeader(ceoToken),
      payload: { type: 'follow_up', title: 'Follow-up de teste' },
    });

    assert.equal(response.statusCode, 201, response.body);

    const [updatedAccount] = await db
      .select()
      .from(customerSuccessAccounts)
      .where(eq(customerSuccessAccounts.id, account.id))
      .limit(1);

    assert.ok(updatedAccount.lastContactAt, 'last_contact_at deveria ter sido preenchido.');
  });

  test('oportunidade CS é criada e vinculada à conta', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/customer-success/opportunities',
      headers: authHeader(ceoToken),
      payload: {
        clientId,
        type: 'upsell',
        title: 'Oportunidade de teste',
        estimatedValue: 5000,
      },
    });

    assert.equal(response.statusCode, 201, response.body);

    const opportunity = response.json().data;
    createdOpportunityIds.push(opportunity.id);

    assert.equal(opportunity.clientId, clientId);
    assert.ok(opportunity.csAccountId, 'csAccountId deveria ter sido preenchido via ensureCsAccount.');
    assert.equal(opportunity.status, 'identified');
  });

  test('stats de CS retornam campos agregados', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/customer-success/stats',
      headers: authHeader(ceoToken),
    });

    assert.equal(response.statusCode, 200, response.body);

    const stats = response.json();
    for (const field of [
      'activeAccounts',
      'onboarding',
      'attention',
      'atRisk',
      'followUpsDue',
      'averageHealthScore',
      'averageSatisfaction',
      'expansionPipelineValue',
    ]) {
      assert.ok(field in stats, `campo ausente: ${field}`);
    }
  });

  test('acesso sem JWT é rejeitado (401)', async () => {
    const response = await app.inject({ method: 'GET', url: '/customer-success/accounts' });
    assert.equal(response.statusCode, 401);
  });

  test('acesso sem permission é rejeitado (403)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/customer-success/accounts',
      headers: authHeader(noPermissionToken),
    });
    assert.equal(response.statusCode, 403);
  });
});
