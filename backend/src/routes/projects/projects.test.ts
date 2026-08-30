import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import { clients, projects, roles, users } from '../../db/schema/index.js';
import { database } from '../../services/database.js';

/*
 * Testes de integração do módulo Projetos + Tarefas. Rodam contra o banco
 * apontado por DATABASE_URL usando `app.inject()` — não sobem um servidor
 * HTTP de verdade. Requer que o seed (`npm run db:seed`) já tenha sido
 * executado, pois o login usa as credenciais do CEO (CEO_EMAIL/CEO_PASSWORD)
 * e as permissions `projects.*`/`tasks.*`/`milestones.*` precisam existir.
 *
 * Todos os registros criados pelos testes são removidos ao final (hook
 * `after`) — apagar `projects` já remove em cascata milestones, tasks,
 * task_comments e task_history.
 */

const app = buildApp();

const runId = Date.now();

let ceoToken: string;
let noPermissionToken: string;
let restrictedRoleId: number | undefined;
let restrictedUserId: number | undefined;
let clientId: number;

const createdProjectIds: number[] = [];

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

async function createProject(overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: authHeader(ceoToken),
    payload: {
      clientId,
      name: `Projeto de Teste ${runId}-${createdProjectIds.length}`,
      ...overrides,
    },
  });

  assert.equal(response.statusCode, 201, response.body);

  const project = response.json().data;
  createdProjectIds.push(project.id);

  return project;
}

async function createTask(
  projectId: number,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/tasks`,
    headers: authHeader(ceoToken),
    payload: {
      title: `Tarefa de Teste ${runId}`,
      ...overrides,
    },
  });

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

  const [client] = await db
    .insert(clients)
    .values({
      type: 'company',
      name: `Cliente para Projetos ${runId}`,
    })
    .returning();

  clientId = client.id;

  // Role e usuário temporários, sem nenhuma permissão vinculada, usados
  // apenas para o teste de "acesso sem permission".
  const [role] = await db
    .insert(roles)
    .values({
      name: `Teste sem permissão (projetos) ${runId}`,
      slug: `test-no-permission-projects-${runId}`,
      description: 'Criada pelos testes automatizados de Projetos + Tarefas.',
    })
    .returning();

  restrictedRoleId = role.id;

  const passwordHash = await bcrypt.hash('senha-teste-123', 4);

  const [user] = await db
    .insert(users)
    .values({
      name: 'Usuário de Teste (sem permissão, projetos)',
      email: `test-no-permission-projects-${runId}@example.com`,
      passwordHash,
      roleId: restrictedRoleId,
      isActive: true,
    })
    .returning();

  restrictedUserId = user.id;

  noPermissionToken = await login(user.email, 'senha-teste-123');
});

after(async () => {
  for (const projectId of createdProjectIds) {
    await db.delete(projects).where(eq(projects.id, projectId));
  }

  await db.delete(clients).where(eq(clients.id, clientId));

  if (restrictedUserId) {
    await db.delete(users).where(eq(users.id, restrictedUserId));
  }

  if (restrictedRoleId) {
    await db.delete(roles).where(eq(roles.id, restrictedRoleId));
  }

  await app.close();
  await database.end();
});

describe('Projetos + Tarefas v1', () => {
  test('cria projeto', async () => {
    const project = await createProject();

    assert.equal(project.clientId, clientId);
    assert.equal(project.status, 'draft');
    assert.equal(project.progress, 0);
  });

  test('cria projeto sem permission (403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: authHeader(noPermissionToken),
      payload: { clientId, name: `Projeto sem permissão ${runId}` },
    });

    assert.equal(response.statusCode, 403);
  });

  test('cria tarefa (e gera task.created em task_history)', async () => {
    const project = await createProject();

    const response = await createTask(project.id);
    assert.equal(response.statusCode, 201, response.body);

    const task = response.json().data;
    assert.equal(task.status, 'todo');
    assert.equal(task.projectId, project.id);

    const historyResponse = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/tasks/${task.id}/history`,
      headers: authHeader(ceoToken),
    });

    assert.equal(historyResponse.statusCode, 200);
    const history = historyResponse.json().data;
    assert.ok(
      history.some((entry: { event: string }) => entry.event === 'task.created'),
      'Deveria existir um evento task.created no histórico.',
    );
  });

  test('altera status da tarefa; completed_at ao concluir; reabrir remove completed_at', async () => {
    const project = await createProject();
    const created = await createTask(project.id);
    const task = created.json().data;

    const doneResponse = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}/tasks/${task.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'done' },
    });

    assert.equal(doneResponse.statusCode, 200, doneResponse.body);
    const doneTask = doneResponse.json().data;
    assert.equal(doneTask.status, 'done');
    assert.ok(doneTask.completedAt, 'completed_at deveria estar preenchido ao concluir.');

    const reopenResponse = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}/tasks/${task.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'todo' },
    });

    assert.equal(reopenResponse.statusCode, 200, reopenResponse.body);
    const reopenedTask = reopenResponse.json().data;
    assert.equal(reopenedTask.status, 'todo');
    assert.equal(
      reopenedTask.completedAt,
      null,
      'completed_at deveria ser removido ao reabrir a tarefa.',
    );

    const historyResponse = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/tasks/${task.id}/history`,
      headers: authHeader(ceoToken),
    });

    const history = historyResponse.json().data;
    assert.ok(
      history.some((entry: { event: string }) => entry.event === 'task.reopened'),
      'Deveria existir um evento task.reopened no histórico.',
    );
  });

  test('progresso recalculado após concluir tarefas', async () => {
    const project = await createProject();

    const task1 = (await createTask(project.id)).json().data;
    await createTask(project.id);

    await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}/tasks/${task1.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'done' },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers: authHeader(ceoToken),
    });

    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().data.progress, 50);
  });

  test('tarefa cancelled não entra no denominador do progresso', async () => {
    const project = await createProject();

    const task1 = (await createTask(project.id)).json().data;
    const task2 = (await createTask(project.id)).json().data;
    await createTask(project.id);

    await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}/tasks/${task1.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'done' },
    });

    await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}/tasks/${task2.id}`,
      headers: authHeader(ceoToken),
      payload: { status: 'cancelled' },
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers: authHeader(ceoToken),
    });

    // 3 tarefas, 1 cancelled (fora do denominador), 1 done, 1 todo
    // progress = 1 / 2 = 50%
    assert.equal(detailResponse.json().data.progress, 50);
  });

  test('milestone de outro projeto é rejeitada (422)', async () => {
    const projectA = await createProject();
    const projectB = await createProject();

    const milestoneResponse = await app.inject({
      method: 'POST',
      url: `/projects/${projectA.id}/milestones`,
      headers: authHeader(ceoToken),
      payload: { name: `Milestone do projeto A ${runId}` },
    });

    assert.equal(milestoneResponse.statusCode, 201);
    const milestone = milestoneResponse.json().data;

    const taskResponse = await createTask(projectB.id, {
      milestoneId: milestone.id,
    });

    assert.equal(taskResponse.statusCode, 422);
    assert.equal(taskResponse.json().error, 'invalid_milestone');
  });

  test('assignee inválido é rejeitado (422)', async () => {
    const project = await createProject();

    const response = await createTask(project.id, {
      assigneeUserId: 999999999,
    });

    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error, 'invalid_assignee');
  });

  test('comentário criado', async () => {
    const project = await createProject();
    const task = (await createTask(project.id)).json().data;

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks/${task.id}/comments`,
      headers: authHeader(ceoToken),
      payload: { content: 'Comentário de teste.' },
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.content, 'Comentário de teste.');
  });

  test('acesso sem JWT é rejeitado (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/projects',
    });

    assert.equal(response.statusCode, 401);
  });
});
