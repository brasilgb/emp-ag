import "server-only";

import { NextResponse } from "next/server";

import { getSessionToken } from "@/lib/auth/session";

import { getApiBaseUrl } from "./config";

/**
 * Encaminha uma requisição do navegador para o backend, anexando o JWT lido
 * do cookie HttpOnly. Usada por todas as rotas em app/api/crm/**, que
 * funcionam como um espelho fino do backend — sem lógica de negócio, apenas
 * autenticação de sessão e repasse da requisição/resposta.
 */
export async function proxyToBackend(request: Request, backendPath: string): Promise<NextResponse> {
  const token = await getSessionToken();

  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sessão inválida ou expirada." },
      { status: 401 },
    );
  }

  const { search } = new URL(request.url);
  const targetUrl = `${getApiBaseUrl()}${backendPath}${search}`;

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;

  let response: Response;

  try {
    response = await fetch(targetUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body && body.length > 0 ? body : undefined,
      cache: "no-store",
    });
  } catch (error) {
    console.error(`Falha ao encaminhar requisição para ${targetUrl}`, error);
    return NextResponse.json(
      { error: "connection_error", message: "Não foi possível se conectar ao servidor." },
      { status: 502 },
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  return NextResponse.json(payload, { status: response.status });
}
