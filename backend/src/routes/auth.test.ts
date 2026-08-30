import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { permissions, roles, rolePermissions, users } from '../db/schema/index.js';
import { database } from '../services/database.js';

/*
 * Testes de integração de /auth/me. Rodam contra o banco apontado por
 * DATABASE_URL via `app.inject()` (sem subir servidor HTTP de verdade).
 * Cria uma role/usuário temporários vinculados a uma permissão já existente
 * (clients.read, do seed) para não mexer na tabela `permissions`.
 */

const app = buildApp();

const runId = Date.now();
const PERMISSION_SLUG = 'clients.read';

let userId: number;
let roleId: number;
let token: string;

function authHeader(value: string) {
  return { authorization: `Bearer ${value}` };
}

before(async () => {
  await app.ready();

  const [permission] = await db
    .select()
    .from(permissions)
    .where(eq(permissions.slug, PERMISSION_SLUG))
    .limit(1);

  assert.ok(permission, `Permissão "${PERMISSION_SLUG}" precisa existir (rode npm run db:seed).`);

  const [role] = await db
    .insert(roles)
    .values({
      name: `Teste auth/me ${runId}`,
      slug: `test-auth-me-${runId}`,
      description: 'Criada pelos testes automatizados de auth/me.',
    })
    .returning();

  roleId = role.id;

  await db.insert(rolePermissions).values({ roleId, permissionId: permission.id });

  const passwordHash = await bcrypt.hash('senha-teste-123', 4);

  const [user] = await db
    .insert(users)
    .values({
      name: 'Usuário de Teste (auth/me)',
      email: `test-auth-me-${runId}@example.com`,
      passwordHash,
      roleId,
      isActive: true,
    })
    .returning();

  userId = user.id;

  // Assinado diretamente (sem passar por /auth/login), do mesmo jeito que o
  // backend assina ao autenticar.
  token = app.jwt.sign({ sub: String(user.id), email: user.email, role: role.slug });
});

after(async () => {
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(roles).where(eq(roles.id, roleId));

  await app.close();
  await database.end();
});

describe('GET /auth/me', () => {
  test('retorna usuário autenticado, com role e permissions, sem passwordHash', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeader(token),
    });

    assert.equal(response.statusCode, 200);

    const { user } = response.json();

    assert.equal(user.id, userId);
    assert.equal(user.email, `test-auth-me-${runId}@example.com`);

    assert.equal(user.role.id, roleId);
    assert.equal(user.role.slug, `test-auth-me-${runId}`);

    assert.ok(Array.isArray(user.permissions));
    assert.ok(user.permissions.includes(PERMISSION_SLUG));

    assert.equal('passwordHash' in user, false);
    assert.equal(JSON.stringify(response.json()).includes('passwordHash'), false);
  });

  test('rejeita token inválido (401)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: authHeader('token-invalido'),
    });

    assert.equal(response.statusCode, 401);
  });

  test('rejeita ausência de token (401)', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' });
    assert.equal(response.statusCode, 401);
  });

  test('rejeita usuário inativo (401) e não retorna permissions', async () => {
    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: authHeader(token),
      });

      assert.equal(response.statusCode, 401);
      assert.equal('permissions' in (response.json().user ?? {}), false);
    } finally {
      await db.update(users).set({ isActive: true }).where(eq(users.id, userId));
    }
  });
});
