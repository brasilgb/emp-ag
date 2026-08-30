"use client";

import { createContext, type ReactNode } from "react";

import { can, canAll, canAny } from "@/lib/auth/permissions";
import type { AuthUser } from "@/types/auth";

export interface AuthContextValue {
  user: AuthUser;
  can: (permission: string) => boolean;
  canAny: (permissions: string[]) => boolean;
  canAll: (permissions: string[]) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Disponibiliza o usuário autenticado (com permissões já resolvidas por
 * GET /auth/me) para toda a árvore de Client Components do painel, via
 * `useAuth()`. O usuário chega aqui já pronto — foi buscado no servidor
 * (ver app/(dashboard)/layout.tsx) — então não existe um estado de
 * carregamento aqui dentro, o que evita o flicker de permissão: nenhum
 * botão que dependa de `can(...)` chega a ser desenhado antes de a
 * permissão real ser conhecida.
 */
export function AuthProvider({ user, children }: { user: AuthUser; children: ReactNode }) {
  const value: AuthContextValue = {
    user,
    can: (permission) => can(user.permissions, permission),
    canAny: (permissions) => canAny(user.permissions, permissions),
    canAll: (permissions) => canAll(user.permissions, permissions),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
