export interface Role {
  id: number;
  name: string;
  slug: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

/**
 * Usuário autenticado com as permissões resolvidas (role → role_permissions
 * → permissions), como devolvido por GET /auth/me. É o formato usado em
 * toda a sessão do painel — DAL, contexto de autenticação, sidebar, etc.
 *
 * POST /auth/login não inclui `permissions` na resposta (ver
 * backend/src/routes/auth.ts), por isso o tipo `User` "puro" continua
 * existindo separadamente, só para esse caso.
 */
export interface AuthUser extends User {
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface MeResponse {
  user: AuthUser;
}
