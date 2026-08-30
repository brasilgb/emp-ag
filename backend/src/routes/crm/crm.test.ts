import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  clients,
  crmActivities,
  leads,
  pipelineStages,
  roles,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';

/*
 * Testes de integração do módulo CRM. Rodam contra o banco apontado por
 * DATABASE_URL (o mesmo do `npm run dev`/docker compose) usando
 * `app.inject()` — não sobem um servidor HTTP de verdade. Requer que o seed
 * (`npm run db:seed`) já tenha sido executado, pois o login usa as
 * credenciais do CEO (CEO_EMAIL/CEO_PASSWORD).
 *
 * Todos os registros criados pelos testes são removidos ao final (hook
 * `after`). Ainda assim, recomenda-se rodar contra um banco descartável
 * (ex.: um container Postgres dedicado a testes) em CI.
 */

const app = buildApp();

const runId = Date.now();

let ceoToken: string;
let noPermissionToken: string;
let restrictedRoleId: number | undefined;
let restrictedUserId: number | undefined;

const createdClientIds: number[] = [];
const createdLeadIds: number[] = [];

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

  assert.ok(ceoEmail && ceoPassword, 'CEO_EMAIL/CEO_PASSWORD precisam estar definidos (rode npm run db:seed antes dos testes).');

  ceoToken = await login(ceoEmail, ceoPassword);

  // Role e usuário temporários, sem nenhuma permissão vinculada, usados
  // apenas para o teste de "acesso sem permission".
  const [role] = await db
    .insert(roles)
    .values({
      name: `Teste sem permissão ${runId}`,
      slug: `test-no-permission-${runId}`,
      description: 'Criada pelos testes automatizados do CRM.',
    })
    .returning();

  restrictedRoleId = role.id;

  const passwordHash = await bcrypt.hash('senha-teste-123', 4);

  const [user] = await db
    .insert(users)
    .values({
      name: 'Usuário de Teste (sem permissão)',
      email: `test-no-permission-${runId}@example.com`,
      passwordHash,
      roleId: restrictedRoleId,
      isActive: true,
    })
    .returning();

  restrictedUserId = user.id;

  noPermissionToken = await login(user.email, 'senha-teste-123');
});

after(async () => {
  for (const leadId of createdLeadIds) {
    await db.delete(crmActivities).where(eq(crmActivities.leadId, leadId));
    await db.delete(leads).where(eq(leads.id, leadId));
  }

  for (const clientId of createdClientIds) {
    await db.delete(crmActivities).where(eq(crmActivities.clientId, clientId));
    await db.delete(clients).where(eq(clients.id, clientId));
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

describe('CRM v1', () => {
  test('cria cliente', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: {
        type: 'company',
        name: `Cliente de Teste ${runId}`,
        email: 'contato@clienteteste.com',
      },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();
    assert.equal(body.data.name, `Cliente de Teste ${runId}`);
    assert.equal(body.data.status, 'active');

    createdClientIds.push(body.data.id);
  });

  test('cria lead', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: {
        name: `Lead de Teste ${runId}`,
        email: 'lead@teste.com',
        source: 'website',
      },
    });

    assert.equal(response.statusCode, 201);

    const body = response.json();
    assert.equal(body.data.status, 'open');
    assert.equal(body.data.source, 'website');

    createdLeadIds.push(body.data.id);
  });

  test('probability inválida é rejeitada', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: {
        name: `Lead probabilidade inválida ${runId}`,
        probability: 150,
      },
    });

    assert.equal(response.statusCode, 400);
  });

  test('altera estágio do lead e registra atividade de status_change', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: { name: `Lead para mudar estágio ${runId}` },
    });

    assert.equal(createResponse.statusCode, 201);
    const lead = createResponse.json().data;
    createdLeadIds.push(lead.id);

    const [qualifiedStage] = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.slug, 'qualified'))
      .limit(1);

    assert.ok(qualifiedStage, 'Estágio "qualified" precisa existir (rode npm run db:seed).');

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/crm/leads/${lead.id}`,
      headers: authHeader(ceoToken),
      payload: { pipelineStageId: qualifiedStage.id },
    });

    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json().data.pipelineStageId, qualifiedStage.id);

    const activities = await db
      .select()
      .from(crmActivities)
      .where(eq(crmActivities.leadId, lead.id));

    assert.ok(
      activities.some((activity) => activity.type === 'status_change'),
      'Deveria existir uma atividade do tipo status_change.',
    );
  });

  test('converte lead em cliente (e rejeita conversão duplicada)', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/crm/leads',
      headers: authHeader(ceoToken),
      payload: {
        name: `Lead Convertível ${runId}`,
        companyName: `Empresa Convertível ${runId}`,
        email: 'convertivel@teste.com',
        phone: '11999999999',
      },
    });

    assert.equal(createResponse.statusCode, 201);
    const lead = createResponse.json().data;
    createdLeadIds.push(lead.id);

    const convertResponse = await app.inject({
      method: 'POST',
      url: `/crm/leads/${lead.id}/convert`,
      headers: authHeader(ceoToken),
    });

    assert.equal(convertResponse.statusCode, 200);

    const body = convertResponse.json().data;
    assert.equal(body.client.name, `Empresa Convertível ${runId}`);
    assert.equal(body.lead.convertedClientId, body.client.id);
    assert.equal(body.lead.status, 'won');

    createdClientIds.push(body.client.id);

    const duplicateResponse = await app.inject({
      method: 'POST',
      url: `/crm/leads/${lead.id}/convert`,
      headers: authHeader(ceoToken),
    });

    assert.equal(duplicateResponse.statusCode, 409);
  });

  test('acesso sem JWT é rejeitado (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/crm/clients',
    });

    assert.equal(response.statusCode, 401);
  });

  test('acesso sem permission é rejeitado (403)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/crm/clients',
      headers: authHeader(noPermissionToken),
    });

    assert.equal(response.statusCode, 403);
  });
});
