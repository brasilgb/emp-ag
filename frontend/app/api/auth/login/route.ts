import { NextResponse } from "next/server";

import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { setSessionCookie } from "@/lib/auth/session";
import type { LoginResponse } from "@/types/auth";

interface LoginRequestBody {
  email?: string;
  password?: string;
}

/**
 * BFF do login: recebe e-mail/senha do navegador, encaminha para o backend
 * (POST /auth/login) e, em caso de sucesso, grava o JWT retornado em um
 * cookie HttpOnly. O token nunca é devolvido ao navegador — apenas os dados
 * do usuário.
 */
export async function POST(request: Request) {
  let body: LoginRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_request", message: "Payload inválido." },
      { status: 400 },
    );
  }

  try {
    const data = await apiClient.post<LoginResponse>("/auth/login", {
      email: body.email,
      password: body.password,
    });

    await setSessionCookie(data.token);

    return NextResponse.json({ user: data.user });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.code ?? "login_failed", message: error.message },
        { status: error.status },
      );
    }

    console.error("Falha ao autenticar no backend", error);
    return NextResponse.json(
      {
        error: "connection_error",
        message: "Não foi possível se conectar ao servidor.",
      },
      { status: 502 },
    );
  }
}
