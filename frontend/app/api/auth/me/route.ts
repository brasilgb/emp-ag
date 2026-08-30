import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/dal";

/**
 * Espelha GET /auth/me do backend para o navegador, sem nunca expor o JWT
 * (que fica apenas no cookie HttpOnly, lido no servidor). Consumida pelo
 * hook useCurrentUser (TanStack Query).
 */
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "unauthorized", message: "Usuário não autenticado." },
      { status: 401 },
    );
  }

  return NextResponse.json({ user });
}
