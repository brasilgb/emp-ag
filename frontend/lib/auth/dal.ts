import "server-only";

import { cache } from "react";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { AuthUser, MeResponse } from "@/types/auth";

import { getSessionToken } from "./session";

/**
 * Data Access Layer da autenticação. Centraliza a verificação de sessão:
 * lê o cookie HttpOnly, confirma com o backend (GET /auth/me) que o token
 * ainda é válido e retorna o usuário atual — ou `null`.
 *
 * `React.cache` garante que múltiplas chamadas dentro do mesmo request
 * (layout + página, por exemplo) resultem em uma única chamada ao backend.
 *
 * Qualquer falha (401/403 do backend, ou erro de conexão) resulta em
 * `null`. Isso é uma decisão deliberada: em caso de indisponibilidade do
 * backend, tratamos o usuário como não autenticado em vez de liberar acesso
 * ao painel — a checagem de sessão é sempre "fail closed".
 */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const token = await getSessionToken();

  if (!token) {
    return null;
  }

  try {
    const data = await apiClient.get<MeResponse>("/auth/me", { token });
    return data.user;
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
      console.error("Falha ao verificar sessão com o backend", error);
    }
    return null;
  }
});
