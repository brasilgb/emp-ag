import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "./constants";

// 8h, alinhado ao JWT_EXPIRES_IN padrão do backend (ver backend/src/config/env.ts).
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

/**
 * Grava o JWT emitido pelo backend em um cookie HttpOnly. O token nunca fica
 * acessível ao JavaScript do navegador — apenas o servidor Next.js (Route
 * Handlers e Server Components) consegue lê-lo via `getSessionToken`.
 */
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
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
