"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { listUsersDirectory } from "@/services/users";

/**
 * Diretório mínimo de usuários ativos — reutilizado em qualquer seletor de
 * responsável/atribuído (Projeto e Tarefa). Requer a permissão
 * `users.directory.read`; se o usuário não tiver, a query falha com 403 e o
 * seletor deve tratar isError normalmente (ver components/projects/*-form).
 */
export function useUsersDirectory() {
  return useQuery({
    queryKey: queryKeys.users.directory,
    queryFn: () => listUsersDirectory(),
    staleTime: 5 * 60 * 1000,
  });
}
