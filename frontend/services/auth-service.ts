import type { AuthUser, User } from "@/types/auth";

import { apiFetch, ApiClientError } from "./http";

// Reexportado para não quebrar quem já importa o erro daqui
// (ex.: components/forms/login-form.tsx).
export { ApiClientError };

interface LoginPayload {
  email: string;
  password: string;
}

/**
 * Camada de serviços consumida pelos componentes de cliente. Nunca fala com
 * o backend diretamente — sempre com as rotas internas /api/auth/*, que
 * cuidam do cookie de sessão HttpOnly no servidor.
 */
export async function login(payload: LoginPayload): Promise<User> {
  const { user } = await apiFetch<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return user;
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const { user } = await apiFetch<{ user: AuthUser }>("/api/auth/me");
    return user;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return null;
    }
    throw error;
  }
}
