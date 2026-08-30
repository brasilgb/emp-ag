/**
 * Nome do cookie de sessão. Mantido em um módulo isolado (sem `server-only`
 * e sem importar `next/headers`) para que possa ser lido tanto pelo Proxy
 * (proxy.ts) quanto pela camada de sessão do servidor, sem inflar o bundle
 * do Proxy com dependências desnecessárias.
 */
export const SESSION_COOKIE_NAME = "session_token";
