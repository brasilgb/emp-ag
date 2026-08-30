"use client";

import { useContext } from "react";

import { AuthContext, type AuthContextValue } from "@/components/providers/auth-provider";

/**
 * `const { user, can, canAny, canAll } = useAuth();`
 *
 * Só funciona dentro da árvore do painel autenticado, onde AppShell monta
 * o AuthProvider. Usar fora disso (ex.: nas páginas de login) é um erro de
 * programação — por isso lança, em vez de devolver um valor "vazio"
 * silenciosamente.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth() precisa ser usado dentro de <AuthProvider>.");
  }

  return context;
}
