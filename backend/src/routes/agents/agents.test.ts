import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';

import { buildApp } from '../../app.js';
import { db } from '../../db/index.js';
import {
  agentApprovals,
  agentConversations,
  agentExecutions,
  agentToolPermissions,
  agentTools,
  agents,
  auditLogs,
  clients,
  financialCategories,
  financialEntries,
  permissions,
  projects,
  rolePermissions,
  roles,
  tasks,
  users,
} from '../../db/schema/index.js';
import { database } from '../../services/database.js';
import { redis } from '../../services/redis.js';
import {
  registerTestSupportTools,
  resetTestApprovalSideEffectCount,
  testApprovalSideEffectCount,
} from '../../agents/tools/__test-support__.js';

/*
 * Testes de integração do módulo Agentes v1 + Diretor Virtual (seção 57).
 * Mesmo padrão de support.test.ts: rodam contra o banco apontado por
 * DATABASE_URL usando `app.inject()`, login real via CEO_EMAIL/CEO_PASSWORD
 * (requer `npm run db:seed` já ter rodado — precisa dos 6 agentes/21 tools
 * seedados). Registros criados pelos testes são removidos em `after`.
 */

describe('Agentes v1', () => {
  const app = buildApp();
  registerTestSupportTools();

  const runId = Date.now();

  let ceoToken: string;
  let noAgentsUseToken: string;
  let noDomainPermToken: string;

  let noAgentsUseRoleId: number;
  let noAgentsUseUserId: number;
  let noDomainPermRoleId: number;
  let noDomainPermUserId: number;

  let clientId: number;
  let projectId: number;
  let financialCategoryId: number;
  let financialEntryId: number;

  let testToolId: number;
  let testToolLinkId: number;

  const createdTaskIds: number[] = [];
  const createdExecutionIds: number[] = [];
  const createdConversationIds: number[] = [];

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

  async function createRestrictedUser(slugSuffix: string, permissionSlugs: string[]) {
    const [role] = await db
      .insert(roles)
      .values({
        name: `Teste Agentes ${slugSuffix} ${runId}`,
        slug: `test-agents-${slugSuffix}-${runId}`,
        description: 'Role de teste do módulo de agentes.',
        isSystem: false,
      })
      .returning();

    if (permissionSlugs.length > 0) {
      const permissionRows = await db
        .select()
        .from(permissions)
        .where(inArray(permissions.slug, permissionSlugs));

      for (const permission of permissionRows) {
        await db.insert(rolePermissions).values({ roleId: role.id, permissionId: permission.id });
      }
    }

    const passwordHash = await bcrypt.hash('senha-teste-12345', 4);
    const email = `test-agents-${slugSuffix}-${runId}@example.com`;

    const [user] = await db
      .insert(users)
      .values({
        name: `Usuário Teste Agentes ${slugSuffix} ${runId}`,
        email,
        passwordHash,
        roleId: role.id,
        isActive: true,
      })
      .returning();

    const token = await login(email, 'senha-teste-12345');

    return { roleId: role.id, userId: user.id, token };
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

    // Zera o rate limit de /agents/chat (agents/security/rate-limit.ts —
    // 30 req/60s por usuário) para o usuário CEO antes de começar: este
    // arquivo + llm.test.ts fazem ~25 chamadas reais a /agents/chat com o
    // CEO, e o Redis é compartilhado com qualquer outro uso real do mesmo
    // usuário seed (dev) — sem isso, a suíte fica dependente de estado
    // externo ao processo de teste.
    const [ceoUser] = await db.select().from(users).where(eq(users.email, ceoEmail.toLowerCase())).limit(1);
    if (ceoUser) {
      await redis.del(`agents:ratelimit:chat:${ceoUser.id}`);
    }

    const noAgentsUse = await createRestrictedUser('no-agents-use', []);
    noAgentsUseRoleId = noAgentsUse.roleId;
    noAgentsUseUserId = noAgentsUse.userId;
    noAgentsUseToken = noAgentsUse.token;

    const noDomainPerm = await createRestrictedUser('no-domain-perm', ['agents.use', 'agents.execute']);
    noDomainPermRoleId = noDomainPerm.roleId;
    noDomainPermUserId = noDomainPerm.userId;
    noDomainPermToken = noDomainPerm.token;

    const clientResponse = await app.inject({
      method: 'POST',
      url: '/crm/clients',
      headers: authHeader(ceoToken),
      payload: { type: 'company', name: `Cliente Agentes ${runId}`, status: 'active' },
    });
    assert.equal(clientResponse.statusCode, 201, clientResponse.body);
    clientId = clientResponse.json().data.id;

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: authHeader(ceoToken),
      payload: { clientId, name: `Projeto Agentes ${runId}`, status: 'in_progress' },
    });
    assert.equal(projectResponse.statusCode, 201, projectResponse.body);
    projectId = projectResponse.json().data.id;

    const [category] = await db
      .select()
      .from(financialCategories)
      .where(eq(financialCategories.slug, 'project'))
      .limit(1);
    assert.ok(category, 'Categoria financeira de sistema "project" do seed não encontrada.');
    financialCategoryId = category.id;

    const entryResponse = await app.inject({
      method: 'POST',
      url: '/financial/entries',
      headers: authHeader(ceoToken),
      payload: {
        type: 'income',
        categoryId: financialCategoryId,
        clientId,
        description: `Lançamento Agentes ${runId}`,
        amount: '1500.00',
        issueDate: '2026-01-01',
        dueDate: '2026-01-10',
        competenceDate: '2026-01-01',
      },
    });
    assert.equal(entryResponse.statusCode, 201, entryResponse.body);
    financialEntryId = entryResponse.json().data.id;

    // Tool exclusiva de teste, approval_required (seção 57 #9/#10/#11) —
    // ligada ao agente director, nunca usada em produção (ver
    // agents/tools/__test-support__.ts).
    const [directorAgent] = await db.select().from(agents).where(eq(agents.slug, 'director')).limit(1);
    assert.ok(directorAgent, 'Agente director do seed não encontrado.');

    const [testTool] = await db
      .insert(agentTools)
      .values({
        name: `Test Approval Echo ${runId}`,
        slug: `test-approval-echo-${runId}`,
        description: 'Tool exclusiva de teste do fluxo de aprovação.',
        department: 'director',
        autonomyLevel: 'approval_required',
        handler: 'test.approval_required_echo',
        isActive: true,
        isSensitive: false,
      })
      .returning();
    testToolId = testTool.id;

    const [link] = await db
      .insert(agentToolPermissions)
      .values({ agentId: directorAgent.id, toolId: testTool.id, canUse: true })
      .returning();
    testToolLinkId = link.id;
  });

  after(async () => {
    if (createdExecutionIds.length > 0) {
      await db.delete(agentExecutions).where(inArray(agentExecutions.id, createdExecutionIds));
    }

    if (createdConversationIds.length > 0) {
      await db.delete(agentConversations).where(inArray(agentConversations.id, createdConversationIds));
    }

    for (const id of createdTaskIds) {
      await db.delete(tasks).where(eq(tasks.id, id));
    }

    if (testToolLinkId) {
      await db.delete(agentToolPermissions).where(eq(agentToolPermissions.id, testToolLinkId));
    }

    if (testToolId) {
      await db.delete(agentTools).where(eq(agentTools.id, testToolId));
    }

    if (financialEntryId) {
      await db.delete(financialEntries).where(eq(financialEntries.id, financialEntryId));
    }

    if (projectId) {
      await db.delete(projects).where(eq(projects.id, projectId));
    }

    if (clientId) {
      await db.delete(clients).where(eq(clients.id, clientId));
    }

    await db.delete(users).where(eq(users.id, noAgentsUseUserId));
    await db.delete(users).where(eq(users.id, noDomainPermUserId));
    await db.delete(roles).where(eq(roles.id, noAgentsUseRoleId));
    await db.delete(roles).where(eq(roles.id, noDomainPermRoleId));

    await app.close();
    await database.end();

    // agentRateLimit() é a primeira rota a efetivamente usar o cliente
    // Redis (lazyConnect); sem fechar, o socket aberto mantém o processo
    // de teste vivo indefinidamente (mesmo problema que database.end()
    // resolve para o Postgres).
    redis.disconnect();
  });

  // #1
  test('lista agentes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agents',
      headers: authHeader(ceoToken),
    });

    assert.equal(response.statusCode, 200);
    const slugs = response.json().data.map((row: { slug: string }) => row.slug);

    for (const slug of ['director', 'sales', 'projects', 'finance', 'support', 'customer_success']) {
      assert.ok(slugs.includes(slug), `Agente ${slug} não encontrado na listagem.`);
    }
  });

  // #2
  test('usuário sem agents.use → 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(noAgentsUseToken),
      payload: { message: 'Quais projetos estão atrasados?' },
    });

    assert.equal(response.statusCode, 403);
  });

  // #3
  test('tool inexistente → erro controlado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: { agentSlug: 'finance', toolHandler: 'finance.nope_nope', input: {} },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, 'tool_not_found');
  });

  // #4
  test('agente sem permissão para a tool → 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: { agentSlug: 'sales', toolHandler: 'finance.get_summary', input: {} },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'permission_denied');
  });

  // #5
  test('usuário sem domain permission → 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(noDomainPermToken),
      payload: { agentSlug: 'projects', toolHandler: 'projects.get_overdue_projects', input: {} },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, 'permission_denied');
  });

  // #6 e #18
  test('READ tool executa e gera log de execução', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: { agentSlug: 'projects', toolHandler: 'projects.get_overdue_projects', input: {} },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'completed');
    assert.ok(Array.isArray(body.result.data));
    createdExecutionIds.push(body.executionId);

    const [execution] = await db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, body.executionId))
      .limit(1);
    assert.ok(execution, 'Execução não encontrada.');
    assert.equal(execution.status, 'completed');

    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'agent.execution.completed'), eq(auditLogs.entityId, String(body.executionId))),
      );
    assert.ok(auditRows.length > 0, 'Log de auditoria da execução não encontrado.');
  });

  // #7
  test('PREPARE não altera banco', async () => {
    const [before_] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, financialEntryId))
      .limit(1);

    const response = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: {
        agentSlug: 'finance',
        toolHandler: 'finance.prepare_payment_reminder',
        input: { entryId: financialEntryId },
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'completed');
    assert.ok(body.result.data.draftMessage);
    createdExecutionIds.push(body.executionId);

    const [after_] = await db
      .select()
      .from(financialEntries)
      .where(eq(financialEntries.id, financialEntryId))
      .limit(1);

    assert.equal(after_.status, before_.status);
    assert.equal(after_.amount, before_.amount);
    assert.equal(after_.updatedAt.getTime(), before_.updatedAt.getTime());
  });

  // #8
  test('EXECUTE interna altera banco', async () => {
    const title = `Tarefa via agente ${runId}`;

    const response = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: {
        agentSlug: 'projects',
        toolHandler: 'projects.create_internal_task',
        input: { projectId, title },
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.status, 'completed');
    createdExecutionIds.push(body.executionId);
    createdTaskIds.push(body.result.data.id);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, body.result.data.id)).limit(1);
    assert.ok(task, 'Tarefa não foi criada no banco.');
    assert.equal(task.title, title);
    assert.equal(task.executionType, 'agent');
  });

  // #9
  test('approval_required cria approval e não executa', async () => {
    resetTestApprovalSideEffectCount();

    const response = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: { agentSlug: 'director', toolHandler: 'test.approval_required_echo', input: {} },
    });

    assert.equal(response.statusCode, 202);
    const body = response.json();
    assert.equal(body.status, 'waiting_approval');
    assert.ok(body.approvalId);
    createdExecutionIds.push(body.executionId);

    assert.equal(testApprovalSideEffectCount, 0);

    const [execution] = await db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, body.executionId))
      .limit(1);
    assert.equal(execution.status, 'waiting_approval');

    const [approval] = await db
      .select()
      .from(agentApprovals)
      .where(eq(agentApprovals.id, body.approvalId))
      .limit(1);
    assert.equal(approval.status, 'pending');
  });

  // #10
  test('aprovação executa exatamente uma vez', async () => {
    resetTestApprovalSideEffectCount();

    const executeResponse = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: { agentSlug: 'director', toolHandler: 'test.approval_required_echo', input: {} },
    });
    assert.equal(executeResponse.statusCode, 202);
    const { approvalId, executionId } = executeResponse.json();
    createdExecutionIds.push(executionId);

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/agents/approvals/${approvalId}/approve`,
        headers: authHeader(ceoToken),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/agents/approvals/${approvalId}/approve`,
        headers: authHeader(ceoToken),
        payload: {},
      }),
    ]);

    const statusCodes = [first.statusCode, second.statusCode].sort();
    assert.deepEqual(statusCodes, [200, 409]);
    assert.equal(testApprovalSideEffectCount, 1);
  });

  // #11
  test('rejeição não executa', async () => {
    resetTestApprovalSideEffectCount();

    const executeResponse = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload: { agentSlug: 'director', toolHandler: 'test.approval_required_echo', input: {} },
    });
    assert.equal(executeResponse.statusCode, 202);
    const { approvalId, executionId } = executeResponse.json();
    createdExecutionIds.push(executionId);

    const rejectResponse = await app.inject({
      method: 'POST',
      url: `/agents/approvals/${approvalId}/reject`,
      headers: authHeader(ceoToken),
      payload: {},
    });

    assert.equal(rejectResponse.statusCode, 200);
    assert.equal(rejectResponse.json().status, 'rejected');
    assert.equal(testApprovalSideEffectCount, 0);

    const [execution] = await db.select().from(agentExecutions).where(eq(agentExecutions.id, executionId)).limit(1);
    assert.equal(execution.status, 'rejected');
  });

  // #12
  test('retry idempotente não duplica', async () => {
    const idempotencyKey = `test-idempotency-${runId}`;
    const title = `Tarefa idempotente ${runId}`;
    const payload = {
      agentSlug: 'projects',
      toolHandler: 'projects.create_internal_task',
      input: { projectId, title },
      idempotencyKey,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/agents/execute',
      headers: authHeader(ceoToken),
      payload,
    });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);

    const firstBody = first.json();
    const secondBody = second.json();
    assert.equal(firstBody.executionId, secondBody.executionId);
    createdExecutionIds.push(firstBody.executionId);
    createdTaskIds.push(firstBody.result.data.id);

    const matchingTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.title, title)));
    assert.equal(matchingTasks.length, 1);
  });

  // #13-16
  test('router: financeiro', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(ceoToken),
      payload: { message: 'Quanto temos a receber esse mês?' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.agent.slug, 'finance');
    createdConversationIds.push(body.conversationId);
  });

  test('router: projetos', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(ceoToken),
      payload: { message: 'Quais projetos estão atrasados?' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.agent.slug, 'projects');
    createdConversationIds.push(body.conversationId);
  });

  test('router: suporte', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(ceoToken),
      payload: { message: 'Existem chamados críticos em aberto?' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.agent.slug, 'support');
    createdConversationIds.push(body.conversationId);
  });

  test('router: customer success', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(ceoToken),
      payload: { message: 'Quais contas estão em risco de churn?' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.agent.slug, 'customer_success');
    createdConversationIds.push(body.conversationId);
  });

  // #17
  test('intenção desconhecida não inventa resposta', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(ceoToken),
      payload: { message: 'Qual a previsão do tempo amanhã?' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.agent, null);
    assert.match(body.message, /Não consegui identificar/);
    createdConversationIds.push(body.conversationId);
  });

  // #19
  test('conversa salva mensagens', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(ceoToken),
      payload: { message: 'Quais projetos estão atrasados?' },
    });
    assert.equal(first.statusCode, 200);
    const conversationId = first.json().conversationId;
    createdConversationIds.push(conversationId);

    const second = await app.inject({
      method: 'POST',
      url: '/agents/chat',
      headers: authHeader(ceoToken),
      payload: { conversationId, message: 'E os chamados críticos?' },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().conversationId, conversationId);

    const detail = await app.inject({
      method: 'GET',
      url: `/agents/conversations/${conversationId}`,
      headers: authHeader(ceoToken),
    });

    assert.equal(detail.statusCode, 200);
    const messages = detail.json().data.messages;
    assert.equal(messages.length, 4);
    assert.deepEqual(
      messages.map((m: { role: string }) => m.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
  });

  // #20
  test('sem JWT → 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/agents',
    });

    assert.equal(response.statusCode, 401);
  });
});
