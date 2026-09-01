import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "./constants";

// 8h, alinhado ao JWT_EXPIRES_IN padrão do backend (ver backend/src/config/env.ts).
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/**
 * Cookie `Secure` exige HTTPS — o navegador descarta silenciosamente um
 * `Set-Cookie: ...; Secure` recebido por uma origem HTTP simples (RFC 6265
 * §5.3/8.6). `NODE_ENV === "production"` não é um proxy confiável para "a
 * conexão é HTTPS": esta app roda em produção atrás de HTTP puro até o
 * Nginx com TLS (ver docs/INFRASTRUCTURE.md §33/34) entrar no ar. Por isso
 * o flag é controlado por `COOKIE_SECURE` (padrão "true", desligado via
 * .env só enquanto não há TLS na frente) em vez de amarrado a NODE_ENV.
 */
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";

/**
 * Grava o JWT emitido pelo backend em um cookie HttpOnly. O token nunca fica
 * acessível ao JavaScript do navegador — apenas o servidor Next.js (Route
 * Handlers e Server Components) consegue lê-lo via `getSessionToken`.
 */
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
