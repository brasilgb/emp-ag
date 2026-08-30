/**
 * Funções puras de checagem de permissão — sem React, sem sessão, testáveis
 * isoladamente (ver permissions.test.ts). `useAuth()` (use-auth.ts) as
 * expõe de forma ergonômica já ligadas ao usuário da sessão atual.
 *
 * Importante: isto é só UX. A autorização de verdade continua sendo feita
 * pelo backend (`authenticate` + `requirePermission`) — esconder um botão
 * aqui nunca substitui a checagem no servidor.
 */

export function can(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}

/** true se possuir pelo menos uma das permissões informadas. */
export function canAny(permissions: string[], required: string[]): boolean {
  return required.some((permission) => permissions.includes(permission));
}

/** true apenas se possuir todas as permissões informadas. */
export function canAll(permissions: string[], required: string[]): boolean {
  return required.every((permission) => permissions.includes(permission));
}
