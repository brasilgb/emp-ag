"use client";

import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth/use-auth";

interface PermissionGateProps {
  /** Exige exatamente esta permissão. */
  permission?: string;
  /** Exige pelo menos uma das permissões da lista. */
  any?: string[];
  /** Exige todas as permissões da lista. */
  all?: string[];
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * `<PermissionGate permission="clients.create"><Button>Novo Cliente</Button></PermissionGate>`
 *
 * Só controla UX (esconder/mostrar). O backend continua sendo quem
 * realmente barra a ação via `authenticate`/`requirePermission`.
 */
export function PermissionGate({ permission, any, all, fallback = null, children }: PermissionGateProps) {
  const { can, canAny, canAll } = useAuth();

  let allowed = true;

  if (permission) allowed = allowed && can(permission);
  if (any) allowed = allowed && canAny(any);
  if (all) allowed = allowed && canAll(all);

  return allowed ? <>{children}</> : <>{fallback}</>;
}
