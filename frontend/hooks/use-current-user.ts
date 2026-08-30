"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { fetchCurrentUser } from "@/services/auth-service";
import type { AuthUser } from "@/types/auth";

/**
 * Consulta client-side de /auth/me (via /api/auth/me). A renderização
 * inicial do painel já usa o usuário obtido no servidor (ver
 * app/(dashboard)/layout.tsx); este hook fica disponível para cenários
 * futuros que precisem revalidar a sessão a partir do cliente (ex.: após
 * uma ação que pode invalidar o token).
 */
export function useCurrentUser(initialData?: AuthUser | null) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: fetchCurrentUser,
    initialData,
  });
}
