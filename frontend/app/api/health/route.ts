import { NextResponse } from "next/server";

/**
 * Healthcheck do frontend, usado pelo Docker Compose. Não depende de
 * autenticação nem do backend estar disponível — verifica apenas que o
 * servidor Next.js está de pé.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
