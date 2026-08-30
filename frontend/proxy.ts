import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

// No Next.js 16 o antigo `middleware.ts` foi renomeado para `proxy.ts`
// (mesmo comportamento, nome mais claro sobre o papel de "camada de rede"
// na frente da aplicação).
const PUBLIC_ROUTES = ["/login"];

/**
 * Checagem *otimista* de sessão: só verifica se o cookie existe, sem validar
 * o JWT (o Proxy não tem acesso ao segredo do backend — e não deveria: ver
 * seção "Segurança"). A checagem *segura* de verdade acontece no
 * app/(dashboard)/layout.tsx, que chama o backend (GET /auth/me).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  if (!hasSession && !isPublicRoute) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && isPublicRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
