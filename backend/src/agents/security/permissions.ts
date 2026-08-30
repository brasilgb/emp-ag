import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { permissions, rolePermissions, roles, users } from '../../db/schema/index.js';

// Cópia local, seguindo a convenção já usada em
// routes/{support,projects,customer-success}/helpers.ts (cada módulo tem
// a sua). Usada pelo pipeline de execução para verificar a permission de
// usuário exigida por uma tool (seção 29).
export async function getUserPermissionSlugs(userId: number): Promise<Set<string>> {
  const rows = await db
    .select({ slug: permissions.slug })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(users.id, userId));

  return new Set(rows.map((row) => row.slug));
}
